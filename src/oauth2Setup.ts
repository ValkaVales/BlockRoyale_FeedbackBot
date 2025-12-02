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

function getSuccessPage(email: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Successful</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 24px;
            padding: 60px 40px;
            max-width: 600px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .icon {
            font-size: 80px;
            margin-bottom: 30px;
            animation: bounce 1s ease;
        }
        @keyframes bounce {
            0%, 100% { transform: translateY(0); }
            50% { transform: translateY(-20px); }
        }
        h1 {
            font-size: 42px;
            color: #2d3748;
            margin-bottom: 20px;
            font-weight: 700;
        }
        .email {
            font-size: 24px;
            color: #667eea;
            margin-bottom: 30px;
            font-weight: 600;
        }
        .message {
            font-size: 20px;
            color: #4a5568;
            line-height: 1.6;
            margin-bottom: 40px;
        }
        .check-mark {
            font-size: 28px;
            color: #48bb78;
            margin-right: 10px;
        }
        .info {
            background: #f7fafc;
            padding: 25px;
            border-radius: 12px;
            font-size: 18px;
            color: #2d3748;
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">✅</div>
        <h1>Authentication Successful!</h1>
        <div class="email">${email}</div>
        <div class="message">
            <span class="check-mark">✓</span> Token saved successfully<br>
            <span class="check-mark">✓</span> Gmail service configured<br>
            <span class="check-mark">✓</span> Email notifications enabled
        </div>
        <div class="info">
            Your Gmail token has been saved and the service is now ready to send emails.
            You can close this window.
        </div>
    </div>
</body>
</html>
  `;
}

function getWrongAccountPage(usedEmail: string, requiredEmail: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Wrong Account</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: linear-gradient(135deg, #f093fb 0%, #f5576c 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 24px;
            padding: 60px 40px;
            max-width: 700px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.3);
        }
        .icon {
            font-size: 80px;
            margin-bottom: 30px;
        }
        h1 {
            font-size: 42px;
            color: #2d3748;
            margin-bottom: 20px;
            font-weight: 700;
        }
        .wrong-email {
            font-size: 22px;
            color: #e53e3e;
            margin-bottom: 15px;
            font-weight: 600;
        }
        .required-email {
            font-size: 28px;
            color: #48bb78;
            margin-bottom: 30px;
            font-weight: 700;
            padding: 20px;
            background: #f0fff4;
            border-radius: 12px;
        }
        .message {
            font-size: 20px;
            color: #4a5568;
            line-height: 1.8;
            margin-bottom: 40px;
        }
        .button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 18px 50px;
            border-radius: 12px;
            text-decoration: none;
            font-size: 22px;
            font-weight: 600;
            transition: transform 0.2s;
        }
        .button:hover {
            transform: scale(1.05);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">⚠️</div>
        <h1>Wrong Account</h1>
        <div class="wrong-email">You used: ${usedEmail}</div>
        <div class="message">
            Please sign in with the correct account:
        </div>
        <div class="required-email">${requiredEmail}</div>
        <a href="/oauth/auth" class="button">Try Again with Correct Account</a>
    </div>
</body>
</html>
  `;
}

function getErrorPage(errorMessage: string): string {
  return `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Authentication Error</title>
    <style>
        * {
            margin: 0;
            padding: 0;
            box-sizing: border-box;
        }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
            background: linear-gradient(135deg, #434343 0%, #000000 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .container {
            background: white;
            border-radius: 24px;
            padding: 60px 40px;
            max-width: 600px;
            width: 100%;
            text-align: center;
            box-shadow: 0 20px 60px rgba(0,0,0,0.5);
        }
        .icon {
            font-size: 80px;
            margin-bottom: 30px;
        }
        h1 {
            font-size: 42px;
            color: #2d3748;
            margin-bottom: 30px;
            font-weight: 700;
        }
        .error-message {
            font-size: 20px;
            color: #e53e3e;
            line-height: 1.6;
            margin-bottom: 40px;
            padding: 20px;
            background: #fff5f5;
            border-radius: 12px;
            border-left: 4px solid #e53e3e;
        }
        .button {
            display: inline-block;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 18px 50px;
            border-radius: 12px;
            text-decoration: none;
            font-size: 22px;
            font-weight: 600;
            transition: transform 0.2s;
        }
        .button:hover {
            transform: scale(1.05);
        }
    </style>
</head>
<body>
    <div class="container">
        <div class="icon">❌</div>
        <h1>Authentication Failed</h1>
        <div class="error-message">${errorMessage}</div>
        <a href="/oauth/auth" class="button">Try Again</a>
    </div>
</body>
</html>
  `;
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
      return res.send(getErrorPage('Authorization was cancelled or denied'));
    }

    if (!authorizationCode) {
      return res.send(getErrorPage('No authorization code received'));
    }

    try {
      const tokens = await oauth2Setup.getTokens(authorizationCode);
      const userInfo = await oauth2Setup.validateTokens(tokens);

   const requiredEmail = 'supprtblockroyale@gmail.com';
      if (userInfo.email !== requiredEmail) {
        console.warn(`❌ Wrong account tried to authorize: ${userInfo.email}`);
        return res.send(getWrongAccountPage(userInfo.email, requiredEmail));
      }

      const gmailAccessOk = await oauth2Setup.testGmailAccess(tokens.refresh_token!);

      const { saveRefreshToken } = await import('./tokenStorage');
      await saveRefreshToken(tokens.refresh_token!, `OAuth2 callback - ${userInfo.email}`);

      await sendTokenUpdateNotification(userInfo.email);

      console.log('\n=== OAuth2 Setup Complete ===');
      console.log('✅ Authorization successful!');
      console.log('📧 Authorized email:', userInfo.email);
      console.log('💾 Refresh token saved to tokens.json');
      console.log('📱 Telegram notification sent');
      console.log('\n🚀 Gmail API access:', gmailAccessOk ? 'Working' : 'Failed');

      res.send(getSuccessPage(userInfo.email));

    } catch (error: any) {
      console.error('OAuth2 callback error:', error.message);
      res.send(getErrorPage(`Failed to complete authorization: ${error.message}`));
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
