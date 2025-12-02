import { google, gmail_v1 } from 'googleapis';
import { OAuth2Client, Credentials } from 'google-auth-library';
import { GmailEmailOptions, GmailEmailResponse, GmailConfig } from './types';

export class GmailService {
  private oauth2Client: OAuth2Client;
  private gmail: gmail_v1.Gmail;
  private config: GmailConfig;
  private isTokenValid: boolean = true;
  private lastTokenCheck: Date = new Date();
  private reAuthCallback?: () => void;
  private notificationSent: boolean = false;

  constructor(config: GmailConfig, reAuthCallback?: () => void) {
    this.config = config;
    this.reAuthCallback = reAuthCallback;

    this.oauth2Client = new google.auth.OAuth2(
      config.clientId,
      config.clientSecret,
      config.redirectUrl
    );

    this.oauth2Client.setCredentials({
      refresh_token: config.refreshToken
    });

    this.gmail = google.gmail({ version: 'v1', auth: this.oauth2Client });
  }

  async sendEmail(options: GmailEmailOptions, maxRetries = 3): Promise<GmailEmailResponse> {
    const tokenValid = await this.validateToken();
    if (!tokenValid) {
      return {
        success: false,
        error: 'Gmail authentication failed - re-authorization required',
        errorCode: 'AUTH_REQUIRED',
        timestamp: new Date().toISOString(),
        requiresReAuth: true
      };
    }

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const { token } = await this.oauth2Client.getAccessToken();
        this.oauth2Client.setCredentials({
          access_token: token,
          refresh_token: this.config.refreshToken
        });

        const emailBody = this.createEmailBody(options);

        const response = await this.gmail.users.messages.send({
          userId: 'me',
          requestBody: {
            raw: emailBody
          }
        });

        console.log(`Email sent successfully via Gmail API on attempt ${attempt}:`, response.data.id);

        this.notificationSent = false;
        this.isTokenValid = true;

        return {
          success: true,
          messageId: response.data.id || undefined,
          threadId: response.data.threadId || undefined,
          timestamp: new Date().toISOString()
        };

      } catch (error: any) {
        const isLastAttempt = attempt === maxRetries;
        const isRetryableError = this.isRetryableError(error);
        const isAuthError = this.isAuthenticationError(error);

        console.error(`Gmail API attempt ${attempt} failed:`, error.message);

        if (isAuthError) {
          this.isTokenValid = false;
          await this.handleAuthError();

          return {
            success: false,
            error: 'Authentication failed - re-authorization required',
            errorCode: error.code,
            timestamp: new Date().toISOString(),
            requiresReAuth: true
          };
        }

        if (isLastAttempt || !isRetryableError) {
          return {
            success: false,
            error: error.message,
            errorCode: error.code,
            timestamp: new Date().toISOString()
          };
        }

        const delay = Math.pow(2, attempt - 1) * 1000;
        console.log(`Retrying Gmail API call in ${delay}ms...`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    return {
      success: false,
      error: 'Max retries exceeded',
      timestamp: new Date().toISOString()
    };
  }

  async sendSupportResponse(
    userEmail: string,
    userName: string,
    originalMessage: string,
    responseMessage: string,
    replyToMessageId?: string
  ): Promise<GmailEmailResponse> {
    const options: GmailEmailOptions = {
      to: userEmail,
      subject: 'Re: Your BlockBlast Support Request',
      htmlBody: this.buildResponseTemplate(userName, responseMessage, originalMessage),
      textBody: `Dear ${userName},\n\n${responseMessage}\n\nYour original message: "${originalMessage}"\n\nBest regards,\nBlockBlast Support Team`,
      replyToMessageId
    };

    return this.sendEmail(options);
  }

  async sendConfirmationEmail(
    userEmail: string,
    userName: string,
    requestMessage: string,
    language: string = 'en'
  ): Promise<GmailEmailResponse> {
    const { getLocalization } = await import('./localization');
    const loc = getLocalization(language);

    const template = await this.loadEmailTemplate();

    const imageMap = await this.loadImagesAsBase64();

    const htmlBody = this.processTemplate(template, {
      ...loc,
      ...imageMap,
      USER_EMAIL: userEmail,
      USER_NAME: userName,
      USER_MESSAGE: requestMessage,
      DATE: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
      }),
      TICKET_ID: `TG${Date.now()}`
    });

    const options: GmailEmailOptions = {
      to: userEmail,
      subject: 'Block Royale - Thank you for your message!',
      htmlBody: htmlBody,
      textBody: `Dear ${userName},\n\nThank you for contacting Block Royale support. We have received your request and will respond within 24 hours.\n\nYour message: "${requestMessage}"\n\nBest regards,\nBlock Royale Support Team`
    };

    return this.sendEmail(options);
  }

  private createEmailBody(options: GmailEmailOptions): string {
    const boundary = `boundary_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    const encodedSubject = this.encodeEmailHeader(options.subject);
    const encodedSenderName = this.encodeEmailHeader(this.config.senderName);

    let email = [
      `From: ${encodedSenderName} <${this.config.senderEmail}>`,
      `To: ${options.to}`,
      `Subject: ${encodedSubject}`,
      'MIME-Version: 1.0',
      `Content-Type: multipart/alternative; boundary="${boundary}"`,
      ''
    ];

    if (options.textBody) {
      email.push(`--${boundary}`);
      email.push('Content-Type: text/plain; charset="UTF-8"');
      email.push('Content-Transfer-Encoding: 7bit');
      email.push('');
      email.push(options.textBody);
      email.push('');
    }

    if (options.htmlBody) {
      email.push(`--${boundary}`);
      email.push('Content-Type: text/html; charset="UTF-8"');
      email.push('Content-Transfer-Encoding: 7bit');
      email.push('');
      email.push(options.htmlBody);
      email.push('');
    }

    email.push(`--${boundary}--`);

    const emailString = email.join('\r\n');
    return Buffer.from(emailString)
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  }

  private buildResponseTemplate(userName: string, response: string, originalMessage: string): string {
    return `
    <!DOCTYPE html>
    <html>
    <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>BlockBlast Support Response</title>
        <style>
            body { 
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; 
                line-height: 1.6; 
                color: #333; 
                max-width: 600px; 
                margin: 0 auto; 
                padding: 20px; 
                background-color: #f5f5f5;
            }
            .email-container {
                background: white;
                border-radius: 12px;
                overflow: hidden;
                box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
            }
            .header { 
                background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                color: white; 
                padding: 30px 20px; 
                text-align: center; 
            }
            .logo { 
                font-size: 28px; 
                font-weight: bold;
                margin-bottom: 10px;
            }
            .content { 
                padding: 30px; 
            }
            .greeting {
                font-size: 18px;
                margin-bottom: 20px;
                color: #2c3e50;
            }
            .response-box { 
                background: #f8f9fa; 
                padding: 25px; 
                border-radius: 8px; 
                margin: 20px 0; 
                border-left: 4px solid #667eea;
                font-size: 16px;
                line-height: 1.7;
            }
            .original-message { 
                background: #e3f2fd; 
                padding: 20px; 
                border-radius: 8px; 
                margin: 20px 0; 
                border-left: 4px solid #2196f3; 
            }
            .original-message h4 {
                color: #1976d2;
                margin-top: 0;
                margin-bottom: 15px;
                font-size: 16px;
            }
            .footer { 
                background: #f8f9fa;
                text-align: center; 
                padding: 25px; 
                color: #6c757d; 
                font-size: 14px;
                border-top: 1px solid #dee2e6;
            }
            .signature {
                margin-top: 30px;
                padding-top: 20px;
                border-top: 2px solid #dee2e6;
                font-weight: 500;
                color: #495057;
            }
            .game-icon {
                display: inline-block;
                margin-right: 8px;
                font-size: 20px;
            }
        </style>
    </head>
    <body>
        <div class="email-container">
            <div class="header">
                <div class="logo">🎮 BlockBlast</div>
                <div>Support Team Response</div>
            </div>
            
            <div class="content">
                <div class="greeting">Dear ${userName},</div>
                
                <p>Thank you for contacting BlockBlast support. We have reviewed your request and here's our response:</p>
                
                <div class="response-box">
                    ${response.replace(/\n/g, '<br>')}
                </div>
                
                <div class="original-message">
                    <h4>📝 Your Original Message:</h4>
                    <div style="font-style: italic; color: #555;">
                        "${originalMessage}"
                    </div>
                </div>
                
                <p>If you have any additional questions or need further assistance, please don't hesitate to reply to this email.</p>
                
                <div class="signature">
                    <strong>Best regards,</strong><br>
                    <span class="game-icon">🎯</span>BlockBlast Support Team
                </div>
            </div>
            
            <div class="footer">
                <p><strong>Need more help?</strong> Simply reply to this email and we'll get back to you.</p>
                <p><small>This email was sent in response to your support request. Our team is available 24/7 to assist you.</small></p>
            </div>
        </div>
    </body>
    </html>`;
  }

  private async loadEmailTemplate(): Promise<string> {
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');

    const templatePath = path.join(process.cwd(), 'templates', 'email.html');
    return await fs.readFile(templatePath, 'utf8');
  }

  private async loadImagesAsBase64(): Promise<Record<string, string>> {
    const fs = await import('fs').then(m => m.promises);
    const path = await import('path');

    try {
      const logoPath = path.join(process.cwd(), 'public', 'logo.png');
      const logoBuffer = await fs.readFile(logoPath);
      const logoBase64 = `data:image/png;base64,${logoBuffer.toString('base64')}`;

      const appStorePath = path.join(process.cwd(), 'public', 'app-store-icon.png');
      const googlePlayPath = path.join(process.cwd(), 'public', 'google-play-icon.png');
      const telegramPath = path.join(process.cwd(), 'public', 'telegram-icon.png');

      const appStoreBuffer = await fs.readFile(appStorePath);
      const googlePlayBuffer = await fs.readFile(googlePlayPath);
      const telegramBuffer = await fs.readFile(telegramPath);

      const appStoreBase64 = `data:image/png;base64,${appStoreBuffer.toString('base64')}`;
      const googlePlayBase64 = `data:image/png;base64,${googlePlayBuffer.toString('base64')}`;
      const telegramBase64 = `data:image/png;base64,${telegramBuffer.toString('base64')}`;

      return {
        LOGO_URL: logoBase64,
        APP_STORE_ICON: appStoreBase64,
        GOOGLE_PLAY_ICON: googlePlayBase64,
        TELEGRAM_ICON: telegramBase64
      };
    } catch (error) {
      console.warn('Failed to load images, using fallback URLs:', error);
      const serverUrl = process.env.SERVER_URL || 'http://localhost:3000';
      return {
        LOGO_URL: `${serverUrl}/static/logo.png`,
        APP_STORE_ICON: `${serverUrl}/static/app-store-icon.png`,
        GOOGLE_PLAY_ICON: `${serverUrl}/static/google-play-icon.png`,
        TELEGRAM_ICON: `${serverUrl}/static/telegram-icon.png`
      };
    }
  }

  private encodeEmailHeader(text: string): string {
    return text;
  }

  private quotedPrintableEncode(text: string): string {
    const utf8Bytes = Buffer.from(text, 'utf8');
    let result = '';

    for (let i = 0; i < utf8Bytes.length; i++) {
      const byte = utf8Bytes[i];
      if ((byte >= 33 && byte <= 126) && byte !== 61 && byte !== 63 && byte !== 95) {
        result += String.fromCharCode(byte);
      } else {
        result += '=' + byte.toString(16).toUpperCase().padStart(2, '0');
      }
    }

    result = result.replace(/\s/g, '_');

    return result;
  }

  private processTemplate(template: string, variables: Record<string, any>): string {
    let processed = template;

    Object.entries(variables).forEach(([key, value]) => {
      const regex = new RegExp(`\\[${key}\\]`, 'g');
      processed = processed.replace(regex, String(value));
    });

    return processed;
  }

  private isRetryableError(error: any): boolean {
    const retryableCodes = [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'EAI_AGAIN',
      500, // Internal server error
      502, // Bad gateway
      503, // Service unavailable
      429  // Rate limit exceeded
    ];

    return retryableCodes.includes(error.code) ||
           retryableCodes.includes(error.status) ||
           error.message.includes('timeout') ||
           error.message.includes('network') ||
           error.message.includes('quota');
  }

  private isAuthenticationError(error: any): boolean {
    const authErrors = [
      'invalid_grant',
      'invalid_request',
      'unauthorized_client',
      'access_denied',
      'invalid_scope',
      401, // Unauthorized
      403  // Forbidden
    ];

    const authMessages = [
      'Token has been expired or revoked',
      'invalid_grant',
      'unauthorized',
      'forbidden',
      'invalid refresh token',
      'refresh token expired'
    ];

    return authErrors.includes(error.code) ||
           authErrors.includes(error.status) ||
           authMessages.some(msg => error.message.toLowerCase().includes(msg.toLowerCase()));
  }

  private async handleAuthError(): Promise<void> {
    console.error('🚨 Gmail authentication failed - refresh token invalid');

    if (!this.notificationSent) {
      this.notificationSent = true;

      await this.notifyAuthError();

      if (this.reAuthCallback) {
        this.reAuthCallback();
      }
    }
  }

  async validateToken(): Promise<boolean> {
    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000);
    if (this.isTokenValid && this.lastTokenCheck > fiveMinutesAgo) {
      return true;
    }

    try {
      const { token } = await this.oauth2Client.getAccessToken();

      if (!token) {
        throw new Error('No access token received');
      }

      await this.gmail.users.getProfile({ userId: 'me' });

      this.isTokenValid = true;
      this.lastTokenCheck = new Date();

      return true;

    } catch (error: any) {
      console.error('Token validation failed:', error.message);

      if (this.isAuthenticationError(error)) {
        this.isTokenValid = false;
        await this.handleAuthError();
      }

      return false;
    }
  }

  private async notifyAuthError(): Promise<void> {
    try {
      const escapeMarkdownV2 = (text: string): string => {
        return text.replace(/[_*[\]()~`>#+=|{}.!-]/g, '\\$&');
      };

      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const authUrl = `${baseUrl}/oauth/auth`;

      const message = `🚨 *Gmail Authentication Failed*\n\n` +
                     `Gmail refresh token has expired or been revoked\\. ` +
                     `Email sending is currently disabled\\.\n\n` +
                     `*Action Required:*\n` +
                     `• Visit: ${escapeMarkdownV2(authUrl)}\n` +
                     `• Complete re\\-authorization\n` +
                     `• Token will be automatically saved to tokens\\.json\n\n` +
                     `*Status:* Authentication failure detected\n` +
                     `*Time:* ${new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })}`;

      const { Telegraf } = await import('telegraf');

      if (process.env.BOT_TOKEN && process.env.CHAT_ID) {
        const bot = new Telegraf(process.env.BOT_TOKEN);

        await bot.telegram.sendMessage(process.env.CHAT_ID, message, {
          parse_mode: 'MarkdownV2'
        });

        console.log('Authentication error notification sent via Telegram');
      }
    } catch (error: any) {
      console.error('Failed to send auth error notification:', error.message);
    }
  }

  async refreshToken(): Promise<boolean> {
    try {
      console.log('Attempting to refresh access token...');

      const { credentials } = await this.oauth2Client.refreshAccessToken();

      this.oauth2Client.setCredentials({
        ...credentials,
        refresh_token: this.config.refreshToken
      });

      const isValid = await this.validateToken();

      if (isValid) {
        console.log('✅ Token refresh successful');
        this.isTokenValid = true;
        this.notificationSent = false;
      }

      return isValid;

    } catch (error: any) {
      console.error('❌ Token refresh failed:', error.message);

      if (this.isAuthenticationError(error)) {
        await this.handleAuthError();
      }

      return false;
    }
  }

  getTokenStatus(): { valid: boolean; lastCheck: Date; needsReAuth: boolean } {
    return {
      valid: this.isTokenValid,
      lastCheck: this.lastTokenCheck,
      needsReAuth: !this.isTokenValid
    };
  }

  async testConnection(): Promise<boolean> {
    try {
      const { token } = await this.oauth2Client.getAccessToken();

      if (!token) {
        throw new Error('Failed to obtain access token');
      }

      const response = await this.gmail.users.getProfile({
        userId: 'me'
      });

      console.log('Gmail API connection successful:', response.data.emailAddress);
      return true;

    } catch (error: any) {
      console.error('Gmail API connection failed:', error.message);
      return false;
    }
  }

  async getSendingQuota(): Promise<{ messagesRemaining: number; dailyLimit: number } | null> {
    try {
      return {
        messagesRemaining: 1000, // Default Gmail API limit
        dailyLimit: 1000
      };
    } catch (error: any) {
      console.error('Failed to get sending quota:', error.message);
      return null;
    }
  }
}

export async function createGmailService(reAuthCallback?: () => void): Promise<GmailService | null> {
  const { loadRefreshToken } = await import('./tokenStorage');

  // Load refresh token from file (falls back to .env if file doesn't exist)
  const refreshToken = await loadRefreshToken();

  const config: GmailConfig = {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: refreshToken || '',
    redirectUrl: process.env.GOOGLE_REDIRECT_URL || 'http://localhost:3000/oauth/callback',
    senderEmail: process.env.GMAIL_SENDER_EMAIL || '',
    senderName: process.env.GMAIL_SENDER_NAME || 'BlockBlast Support'
  };

  const requiredFields = ['clientId', 'clientSecret', 'refreshToken', 'senderEmail'];
  const missingFields = requiredFields.filter(field => !config[field as keyof GmailConfig]);

  if (missingFields.length > 0) {
    console.warn(`Gmail service not configured. Missing: ${missingFields.join(', ')}`);
    return null;
  }

  return new GmailService(config, reAuthCallback);
}

let globalGmailService: GmailService | null = null;
let initializationPromise: Promise<GmailService | null> | null = null;

export function getGmailService(): GmailService | null {
  if (!initializationPromise) {
    initializeGmailService();
  }
  return globalGmailService;
}

export async function getGmailServiceAsync(): Promise<GmailService | null> {
  if (!initializationPromise) {
    initializeGmailService();
  }
  return await initializationPromise;
}

async function initializeGmailService(): Promise<void> {
  if (initializationPromise) return;

  initializationPromise = (async () => {
    globalGmailService = await createGmailService(() => {
      console.log('🔄 Re-authorization callback triggered');
    });

    if (globalGmailService) {
      startTokenMonitoring(globalGmailService);
    }

    return globalGmailService;
  })();

  await initializationPromise;
}

function startTokenMonitoring(service: GmailService): void {
  const intervalMs = 30 * 60 * 1000;

  setInterval(async () => {
    try {
      console.log('🔍 Gmail token monitoring check started...');

      const status = service.getTokenStatus();

      if (!status.valid) {
        console.log('⚠️  Gmail token invalid - attempting refresh...');

        const refreshed = await service.refreshToken();

        if (!refreshed) {
          console.error('❌ Gmail token refresh failed - manual re-auth required');
        } else {
          console.log('✅ Gmail token refreshed successfully');
        }
      } else {
        console.log(`✅ Gmail token valid - last check: ${status.lastCheck.toISOString()}`);
      }

      const isWorking = await service.testConnection();
      console.log(`🧪 Gmail API test: ${isWorking ? '✅ Working' : '❌ Failed'}`);

    } catch (error: any) {
      console.error('❌ Token monitoring error:', error.message);
    }
  }, intervalMs);

  console.log(`🔍 Started Gmail token monitoring (every ${intervalMs / 1000 / 60} minutes)`);

  setTimeout(async () => {
    console.log('🔍 Performing initial Gmail token check...');
    try {
      const status = service.getTokenStatus();
      console.log(`🔑 Token status: ${status.valid ? '✅ Valid' : '❌ Invalid'} - Last check: ${status.lastCheck.toISOString()}`);

      const isWorking = await service.testConnection();
      console.log(`🧪 Initial Gmail API test: ${isWorking ? '✅ Working' : '❌ Failed'}`);
    } catch (error: any) {
      console.error('❌ Initial token check failed:', error.message);
    }
  }, 2000); // Wait 2 seconds after startup
}

export function generateOAuth2Url(clientId: string, redirectUrl: string): string {
  const oauth2Client = new google.auth.OAuth2(clientId, '', redirectUrl);

  const scopes = [
    'https://www.googleapis.com/auth/gmail.send',
    'https://www.googleapis.com/auth/gmail.readonly'
  ];

  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent' // Force consent to get refresh token
  });
}
