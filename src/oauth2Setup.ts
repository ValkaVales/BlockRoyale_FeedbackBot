import { google, oauth2_v2 } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import express from 'express';
import { OAuth2Credentials } from './types';


async function sendTokenUpdateNotification(email: string): Promise<void> {
  try {
    const { Telegraf } = await import('telegraf');

    if (!process.env.BOT_TOKEN || !process.env.CHAT_ID) {
      console.warn('⚠️  Telegram notification skipped: BOT_TOKEN or CHAT_ID not configured');
      return;
    }

    const bot = new Telegraf(process.env.BOT_TOKEN);

    const message = `✅ *Gmail Token Updated*\n\n` +
                   `🔑 Refresh token has been successfully updated\n` +
                   `📧 Email: ${email}\n` +
                   `⏰ Time: ${new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })}\n` +
                   `💾 Saved to: tokens.json\n\n` +
                   `The Gmail service will automatically use the new token.`;

    await bot.telegram.sendMessage(process.env.CHAT_ID, message, {
      parse_mode: 'Markdown'
    });

    console.log('📱 Token update notification sent to Telegram');
  } catch (error: any) {
    console.error('❌ Failed to send Telegram notification:', error.message);
  }
}


export class OAuth2Setup {
  private oauth2Client: OAuth2Client;
  private clientId: string;
  private clientSecret: string;
  private redirectUrl: string;

  constructor(clientId: string, clientSecret: string, redirectUrl: string) {
    this.clientId = clientId;
    this.clientSecret = clientSecret;
    this.redirectUrl = redirectUrl;

    this.oauth2Client = new google.auth.OAuth2(
      this.clientId,
      this.clientSecret,
      this.redirectUrl
    );
  }

  getAuthUrl(): string {
    const scopes = [
      'https://www.googleapis.com/auth/gmail.send',
      'https://www.googleapis.com/auth/gmail.readonly',
      'https://www.googleapis.com/auth/userinfo.email'
    ];

    const authUrl = this.oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent',
      include_granted_scopes: true,
      state: String(Date.now())
    });

    return authUrl;
  }

  async getTokens(authorizationCode: string): Promise<Credentials> {
    try {
      const { tokens } = await this.oauth2Client.getToken(authorizationCode);

      if (!tokens.refresh_token) {
        throw new Error('No refresh token received. Make sure to revoke existing access and re-authorize.');
      }

      return tokens;
    } catch (error: any) {
      console.error('Error exchanging code for tokens:', error.message);
      throw error;
    }
  }

  async validateTokens(tokens: Credentials): Promise<any> {
    try {
      this.oauth2Client.setCredentials(tokens);

      const oauth2Service: oauth2_v2.Oauth2 = google.oauth2({ version: 'v2', auth: this.oauth2Client });
      const { data } = await oauth2Service.userinfo.get();

      return {
        email: data.email,
        verified: data.verified_email,
        name: data.name
      };
    } catch (error: any) {
      console.error('Error validating tokens:', error.message);
      throw error;
    }
  }

  async refreshAccessToken(refreshToken: string): Promise<Credentials> {
    try {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      return credentials;
    } catch (error: any) {
      console.error('Error refreshing access token:', error.message);
      throw error;
    }
  }

  async testGmailAccess(refreshToken: string): Promise<boolean> {
    try {
      this.oauth2Client.setCredentials({ refresh_token: refreshToken });

      const gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
      const { data } = await gmail.users.getProfile({ userId: 'me' });

      console.log('Gmail API access successful for:', data.emailAddress);
      return true;
    } catch (error: any) {
      console.error('Gmail API access failed:', error.message);
      return false;
    }
  }
}

export function createOAuth2Routes(
  clientId: string,
  clientSecret: string,
  redirectUrl: string
): express.Router {
  const router = express.Router();
  const oauth2Setup = new OAuth2Setup(clientId, clientSecret, redirectUrl);

  router.get('/auth', (req, res) => {
    const authUrl = oauth2Setup.getAuthUrl();
    console.log('\n=== Gmail OAuth2 Setup ===');
    console.log('1. Visit this URL to authorize the application:');
    console.log(authUrl);
    console.log('\n2. After authorization, you will be redirected to the callback URL');

    res.redirect(authUrl);
  });

  router.get('/callback', async (req, res) => {
    const authorizationCode = req.query.code as string;
    const error = req.query.error as string;

    if (error) {
      return res.status(400).json({
        error: 'Authorization failed',
        details: error
      });
    }

    if (!authorizationCode) {
      return res.status(400).json({
        error: 'No authorization code received'
      });
    }

    try {
      const tokens = await oauth2Setup.getTokens(authorizationCode);

      const userInfo = await oauth2Setup.validateTokens(tokens);

      const gmailAccessOk = await oauth2Setup.testGmailAccess(tokens.refresh_token!);

      const { saveRefreshToken } = await import('./tokenStorage');
      await saveRefreshToken(tokens.refresh_token!, `OAuth2 callback - ${userInfo.email}`);

      await sendTokenUpdateNotification(userInfo.email);

      console.log('\n=== OAuth2 Setup Complete ===');
      console.log('✅ Authorization successful!');
      console.log('📧 Authorized email:', userInfo.email);
      console.log('💾 Refresh token saved to tokens.json');
      console.log('📱 Telegram notification sent');
      console.log('\n🔑 Environment variables (for reference):');
      console.log('GOOGLE_CLIENT_ID=' + clientId);
      console.log('GOOGLE_CLIENT_SECRET=' + clientSecret);
      console.log('GMAIL_SENDER_EMAIL=' + userInfo.email);
      console.log('GMAIL_SENDER_NAME=BlockBlast Support');
      console.log('GOOGLE_REDIRECT_URL=' + redirectUrl);
      console.log('\n🚀 Gmail API access:', gmailAccessOk ? 'Working' : 'Failed');

      res.json({
        success: true,
        message: 'OAuth2 setup complete! Token saved to file and notification sent to Telegram.',
        userInfo,
        tokens: {
          refresh_token: tokens.refresh_token,
        },
        gmailAccess: gmailAccessOk
      });

    } catch (error: any) {
      console.error('OAuth2 callback error:', error.message);

      res.status(500).json({
        error: 'Failed to complete OAuth2 setup',
        details: error.message
      });
    }
  });

  router.get('/test', async (req, res) => {
    const { loadRefreshToken } = await import('./tokenStorage');
    const refreshToken = await loadRefreshToken();

    if (!refreshToken) {
      return res.status(400).json({
        error: 'No refresh token found in tokens.json. Please complete OAuth2 setup first via /oauth/auth'
      });
    }

    try {
      const accessOk = await oauth2Setup.testGmailAccess(refreshToken);

      res.json({
        success: accessOk,
        message: accessOk ? 'Gmail API access working!' : 'Gmail API access failed',
        timestamp: new Date().toISOString()
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Test failed',
        details: error.message
      });
    }
  });

  return router;
}

/**
 * CLI helper for OAuth2 setup
 */
export class OAuth2CLI {
  static async setupInteractive(): Promise<void> {
    console.log('\n🔧 Gmail OAuth2 Setup Helper\n');

    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUrl = process.env.GOOGLE_REDIRECT_URL || 'http://localhost:3000/oauth/callback';

    if (!clientId || !clientSecret) {
      console.error('❌ Error: GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be set in .env file');
      console.log('\n📝 To get these credentials:');
      console.log('1. Go to Google Cloud Console: https://console.cloud.google.com/');
      console.log('2. Create a new project or select existing one');
      console.log('3. Enable Gmail API');
      console.log('4. Create OAuth2 credentials (Web application)');
      console.log('5. Add redirect URI: ' + redirectUrl);
      console.log('6. Copy Client ID and Client Secret to .env file');
      return;
    }

    const oauth2Setup = new OAuth2Setup(clientId, clientSecret, redirectUrl);
    const authUrl = oauth2Setup.getAuthUrl();

    console.log('🔗 Visit this URL to authorize the application:');
    console.log(authUrl);
    console.log('\n📋 After authorization, copy the authorization code from the callback URL');
    console.log('💡 The code will be in the URL parameter: ?code=AUTHORIZATION_CODE');
    console.log('\n⚠️  Make sure to start your server first: npm run dev');
    console.log('🌐 Then visit: http://localhost:3000/oauth/auth');
  }
}

export function setupGmailOAuth2(): express.Router {
  const clientId = process.env.GOOGLE_CLIENT_ID || '';
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || '';
  const redirectUrl = process.env.GOOGLE_REDIRECT_URL || 'http://localhost:3000/oauth/callback';

  if (!clientId || !clientSecret) {
    console.warn('⚠️  Gmail OAuth2 not configured. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in .env');
  }

  return createOAuth2Routes(clientId, clientSecret, redirectUrl);
}
