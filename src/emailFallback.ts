import { Telegraf } from 'telegraf';
import { GmailEmailResponse } from './types';

export class EmailFallbackService {
  private bot: Telegraf;
  private chatId: string;
  private failedEmails: Array<{
    email: string;
    name: string;
    message: string;
    timestamp: Date;
    type: 'confirmation' | 'response';
  }> = [];

  constructor(botToken: string, chatId: string) {
    this.bot = new Telegraf(botToken);
    this.chatId = chatId;
  }

  async handleFailedEmail(
    emailResponse: GmailEmailResponse,
    userEmail: string,
    userName: string,
    message: string,
    type: 'confirmation' | 'response' = 'confirmation'
  ): Promise<void> {
    this.failedEmails.push({
      email: userEmail,
      name: userName,
      message,
      timestamp: new Date(),
      type
    });

    await this.notifyFailedEmail(emailResponse, userEmail, userName, message, type);

    if (emailResponse.requiresReAuth) {
      await this.notifyReAuthRequired();
    }
  }

  private async notifyFailedEmail(
    emailResponse: GmailEmailResponse,
    userEmail: string,
    userName: string,
    message: string,
    type: 'confirmation' | 'response'
  ): Promise<void> {
    try {
      const escapeMarkdown = (text: string): string => {
        return text.replace(/[*_`\[\]()~>#+=|{}!-]/g, '\\$&');
      };

      const typeEmoji = type === 'response' ? '📧' : '✉️';
      const typeText = type === 'response' ? 'Response Email' : 'Confirmation Email';
      
      const telegramMessage = `🚨 *Email Delivery Failed*\\n\\n` +
                             `${typeEmoji} *${typeText} could not be sent*\\n\\n` +
                             `👤 *User:* ${escapeMarkdown(userName)}\\n` +
                             `📧 *Email:* ${escapeMarkdown(userEmail)}\\n` +
                             `❌ *Error:* ${escapeMarkdown(emailResponse.error || 'Unknown error')}\\n\\n` +
                             `💬 *Message Preview:*\\n${escapeMarkdown(message.substring(0, 200))}${message.length > 200 ? '\\.\\.\\.' : ''}\\n\\n` +
                             `⚠️ *Manual email response required\\!*`;

      await this.bot.telegram.sendMessage(this.chatId, telegramMessage, {
        parse_mode: 'MarkdownV2'
      });

      console.log(`Failed email notification sent to Telegram for ${userEmail}`);

    } catch (error: any) {
      console.error('Failed to send Telegram notification:', error.message);
    }
  }

  private async notifyReAuthRequired(): Promise<void> {
    try {
      const baseUrl = process.env.BASE_URL || 'http://localhost:3000';
      const authUrl = `${baseUrl}/oauth/auth`;

      const escapeMarkdown = (text: string): string => {
        return text.replace(/[*_`\[\]()~>#+=|{}!-]/g, '\\$&');
      };

      const message = `🔐 *Gmail Re\\-Authorization Required*\\n\\n` +
                     `Gmail API access has been revoked or expired\\. ` +
                     `All email sending is currently disabled\\.\\n\\n` +
                     `*Immediate Action Required:*\\n` +
                     `• Visit: ${escapeMarkdown(authUrl)}\\n` +
                     `• Complete Google OAuth authorization\\n` +
                     `• Token will be automatically saved to tokens\\.json\\n\\n` +
                     `*Failed Emails:* ${this.failedEmails.length} pending retry\\n` +
                     `*Auto\\-retry:* Every 30 minutes`;

      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'MarkdownV2'
      });

    } catch (error: any) {
      console.error('Failed to send re-auth notification:', error.message);
    }
  }

  async retryFailedEmails(gmailService: any): Promise<void> {
    if (this.failedEmails.length === 0) {
      console.log('No failed emails to retry');
      return;
    }

    console.log(`Retrying ${this.failedEmails.length} failed emails...`);

    const retryResults = {
      success: 0,
      failed: 0
    };

    for (const failedEmail of [...this.failedEmails]) {
      try {
        let result: GmailEmailResponse;

        if (failedEmail.type === 'confirmation') {
          result = await gmailService.sendConfirmationEmail(
            failedEmail.email,
            failedEmail.name,
            failedEmail.message
          );
        } else {
          result = await gmailService.sendSupportResponse(
            failedEmail.email,
            failedEmail.name,
            'Your original request',
            failedEmail.message
          );
        }

        if (result.success) {
          this.failedEmails = this.failedEmails.filter(email => email !== failedEmail);
          retryResults.success++;
          console.log(`Successfully retried email to ${failedEmail.email}`);
        } else {
          retryResults.failed++;
          console.log(`Retry failed for email to ${failedEmail.email}:`, result.error);
        }

      } catch (error: any) {
        retryResults.failed++;
        console.error(`Error retrying email to ${failedEmail.email}:`, error.message);
      }

      await new Promise(resolve => setTimeout(resolve, 1000));
    }

    await this.notifyRetryResults(retryResults);
  }

  private async notifyRetryResults(results: { success: number; failed: number }): Promise<void> {
    try {
      const message = `🔄 *Email Retry Complete*\\n\\n` +
                     `✅ *Successful:* ${results.success}\\n` +
                     `❌ *Failed:* ${results.failed}\\n` +
                     `📝 *Pending:* ${this.failedEmails.length}`;

      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'MarkdownV2'
      });

    } catch (error: any) {
      console.error('Failed to send retry notification:', error.message);
    }
  }

  getFailedEmailsCount(): number {
    return this.failedEmails.length;
  }

  getFailedEmails(): Array<{
    email: string;
    name: string;
    message: string;
    timestamp: Date;
    type: 'confirmation' | 'response';
  }> {
    return [...this.failedEmails];
  }

  clearFailedEmails(): void {
    this.failedEmails = [];
    console.log('Failed emails queue cleared');
  }

  async sendFailedEmailsList(): Promise<void> {
    if (this.failedEmails.length === 0) {
      return;
    }

    try {
      const escapeMarkdown = (text: string): string => {
        return text.replace(/[*_`\[\]()~>#+=|{}!-]/g, '\\$&');
      };

      let message = `📋 *Failed Emails Queue \\(${this.failedEmails.length}\\)*\\n\\n`;

      this.failedEmails.slice(0, 10).forEach((email, index) => {
        const typeEmoji = email.type === 'response' ? '📧' : '✉️';
        message += `${index + 1}\\. ${typeEmoji} ${escapeMarkdown(email.name)}\\n` +
                   `   📧 ${escapeMarkdown(email.email)}\\n` +
                   `   🕒 ${email.timestamp.toLocaleString()}\\n\\n`;
      });

      if (this.failedEmails.length > 10) {
        message += `\\.\\.\\. and ${this.failedEmails.length - 10} more emails`;
      }

      await this.bot.telegram.sendMessage(this.chatId, message, {
        parse_mode: 'MarkdownV2'
      });

    } catch (error: any) {
      console.error('Failed to send emails list:', error.message);
    }
  }
}

let globalFallbackService: EmailFallbackService | null = null;

export function getFallbackService(): EmailFallbackService | null {
  if (!globalFallbackService) {
    const botToken = process.env.BOT_TOKEN;
    const chatId = process.env.CHAT_ID;

    if (!botToken || !chatId) {
      console.warn('Email fallback service not configured - BOT_TOKEN and CHAT_ID required');
      return null;
    }

    globalFallbackService = new EmailFallbackService(botToken, chatId);
  }

  return globalFallbackService;
}

export function startAutoRetry(gmailService: any, intervalMinutes = 60): void {
  const fallbackService = getFallbackService();
  
  if (!fallbackService) {
    console.warn('Cannot start auto-retry - fallback service not available');
    return;
  }

  const intervalMs = intervalMinutes * 60 * 1000;

  setInterval(async () => {
    const failedCount = fallbackService.getFailedEmailsCount();
    
    if (failedCount > 0) {
      console.log(`🔄 Auto-retry starting for ${failedCount} failed emails...`);
      await fallbackService.retryFailedEmails(gmailService);
    }
  }, intervalMs);

  console.log(`🕐 Email auto-retry started (every ${intervalMinutes} minutes)`);
}