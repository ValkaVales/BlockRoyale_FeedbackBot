import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';
import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import { Telegraf } from 'telegraf';
import { SupportRequest, ApiResponse, ErrorResponse } from './types';
import { getGmailService } from './emailService';
import { getFallbackService, startAutoRetry } from './emailFallback';
import { setupGmailOAuth2 } from './oauth2Setup';
import { quickTokenCheck } from './tokenChecker';

dotenv.config();

const app = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);

app.set('trust proxy', 1);

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!BOT_TOKEN || !CHAT_ID || !WEBHOOK_SECRET) {
  console.error('Error: BOT_TOKEN, CHAT_ID and WEBHOOK_SECRET must be provided in environment variables');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

async function sendGmailNotConfiguredNotification(baseUrl: string): Promise<void> {
  if (!CHAT_ID) {
    console.warn('Cannot send notification: CHAT_ID not configured');
    return;
  }

  try {
    const authUrl = `${baseUrl}/oauth/auth`;
    const message = `⚠️ *Gmail Service Not Configured*\n\n` +
                   `🔑 No refresh token found - Gmail integration is disabled\n` +
                   `📧 Email confirmations will not be sent\n\n` +
                   `*Action Required:*\n` +
                   `• Visit: ${authUrl}\n` +
                   `• Complete Google OAuth authorization\n` +
                   `• Token will be saved to tokens.json\n\n` +
                   `*Status:* Server started without Gmail access\n` +
                   `*Time:* ${new Date().toLocaleString('en-US', { timeZone: 'Europe/Kyiv' })}`;

    await bot.telegram.sendMessage(CHAT_ID, message, {
      parse_mode: 'Markdown'
    });

    console.log('📱 Gmail not configured notification sent to Telegram');
  } catch (error: any) {
    console.error('❌ Failed to send Gmail notification:', error.message);
  }
}

const gmailService = getGmailService();
const fallbackService = getFallbackService();

app.use('/oauth', setupGmailOAuth2());

app.use(cors({
  origin: function (origin, callback) {

    if (!origin) return callback(null, true);

    const allowedOrigins = [
      'https://gpnnmlgcha.a.pinggy.link',
      'http://localhost:3000',
      'http://localhost:8080',
      'https://localhost',
      'https://localhost:8080',
      'https://localhost:3000',
      'https://starspyramid.com:8433',
        'https://api.blockroyale.biz',
        'https://blockroyale.biz',
      /\.pinggy\.link$/,
      /\.ngrok\.io$/,
      /\.herokuapp\.com$/,
      /\.starspyramid\.com(:\d+)?$/,
        /\.blockroyale\.biz(:\d+)?$/,
      /^file:\/\//,
      /^capacitor:\/\//,
      /^ionic:\/\//,
      /^https?:\/\/localhost(:\d+)?$/,
    ];

    const isAllowed = allowedOrigins.some(pattern => {
      if (typeof pattern === 'string') {
        return origin === pattern;
      }
      return pattern.test(origin);
    });

    if (isAllowed) {
      callback(null, true);
    } else {
      console.log('CORS blocked origin:', origin);
      callback(new Error('Not allowed by CORS'));
    }
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'X-Webhook-Secret', 'Authorization', 'Accept', 'Origin', 'X-Requested-With'],
  credentials: true
}));

app.use(express.json());

app.use('/static', express.static('public'));

const supportRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 2,
  message: {
    error: 'Rate limit exceeded. You can send maximum 2 support requests per 10 minutes. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req, res) => {
    const forwarded = req.headers['x-forwarded-for'];
    if (forwarded && typeof forwarded === 'string') {
      const ip = forwarded.split(',')[0].trim();
      return ipKeyGenerator(ip);
    }

    return ipKeyGenerator(req.ip || req.socket.remoteAddress || 'unknown');
  },
  skip: (req) => {
    return req.path === '/health';
  }
});


function escapeMarkdown(text: string): string {
  return text.replace(/[*_`\[\]()~>#+=|{}!-]/g, '\\$&');
}

async function sendMessageWithRetry(
  bot: any,
  chatId: string,
  message: string,
  options: any,
  maxRetries = 3
): Promise<any> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await bot.telegram.sendMessage(chatId, message, options);
      console.log(`Message sent successfully on attempt ${attempt}`);
      return result;
    } catch (error: any) {
      const isLastAttempt = attempt === maxRetries;
      const isRetryableError = error.response?.error_code === 429 ||
                              error.response?.error_code === 502 ||
                              error.response?.error_code === 503 ||
                              error.code === 'ECONNRESET' ||
                              error.code === 'ETIMEDOUT';

      console.error(`Attempt ${attempt} failed:`, error.message);

      if (isLastAttempt || !isRetryableError) {
        throw error;
      }

      const delay = Math.pow(2, attempt - 1) * 1000;
      console.log(`Retrying in ${delay}ms...`);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

function authenticateWebhook(req: Request): boolean {
  const webhookSecret = req.headers['x-webhook-secret'];
  const authHeader = req.headers['authorization'];

  const providedSecret = (typeof webhookSecret === 'string' ? webhookSecret : null) ||
                        (typeof authHeader === 'string' ? authHeader.replace('Bearer ', '') : null);

  return providedSecret === WEBHOOK_SECRET;
}

interface SupportRequestBody extends SupportRequest {
  language?: string;
}

app.post('/webhook/support', supportRateLimit, async (req: Request<{}, ApiResponse | ErrorResponse, SupportRequestBody>, res: Response<ApiResponse | ErrorResponse>) => {
  try {
    if (!authenticateWebhook(req)) {
      return res.status(401).json({
        error: 'Unauthorized: Invalid webhook secret'
      });
    }

    const { name, email, text, language = 'en' } = req.body;

    const { getSupportedLanguages } = await import('./localization');
    const supportedLanguages = getSupportedLanguages();
    const selectedLanguage = supportedLanguages.includes(language) ? language : 'en';

    if (!name || !email || !text) {
      return res.status(400).json({
        error: 'Missing required fields: name, email, text'
      });
    }

    const currentDate = new Date().toLocaleString('en-US', {
      timeZone: 'Europe/Kyiv',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    });

    const message = `🆘 *New Support Request*\n\n` +
                   `👤 *Name:* ${escapeMarkdown(name)}\n` +
                   `📧 *Email:* ${escapeMarkdown(email)}\n` +
                   `💬 *Message:*\n${escapeMarkdown(text)}\n\n` +
                   `📅 *Date:* ${currentDate}`;

    const createGmailUrl = (requestId: string) => {
      const subject = `Block Royale - Answer to ticket ${requestId}`;
      const body = `\n\n\n\nThis message is a response to your Block Royale support request.\n\nRequest date: ${currentDate}\nTicket ID: ${requestId}\nYour original message: "${text}"`;

      return `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    };

    let gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;

    try {
      const sentMessage = await sendMessageWithRetry(bot, CHAT_ID, message, {
        parse_mode: 'Markdown',
        reply_markup: {
          inline_keyboard: [[
            {
              text: '📧 Reply via Gmail',
              url: gmailUrl
            }
          ]]
        }
      });

      if (sentMessage && sentMessage.message_id) {
        const requestId = `TG${sentMessage.message_id}`;
        gmailUrl = createGmailUrl(requestId);

        const updatedMessage = `🆘 *New Support Request*\n\n` +
                             `🆔 *Request ID:* ${requestId}\n` +
                             `👤 *Name:* ${escapeMarkdown(name)}\n` +
                             `📧 *Email:* ${escapeMarkdown(email)}\n` +
                             `💬 *Message:*\n${escapeMarkdown(text)}\n\n` +
                             `📅 *Date:* ${currentDate}`;

        await bot.telegram.editMessageText(CHAT_ID, sentMessage.message_id, undefined, updatedMessage, {
          parse_mode: 'Markdown',
          reply_markup: {
            inline_keyboard: [[
              {
                text: '📧 Reply via Gmail',
                url: gmailUrl
              }
            ]]
          }
        });
      }
    } catch (telegramError: any) {
      console.error('Telegram notification failed:', telegramError.message);
    }

    if (gmailService) {
      try {
        const emailResult = await gmailService.sendConfirmationEmail(email, name, text, selectedLanguage);

        if (!emailResult.success && fallbackService) {
          await fallbackService.handleFailedEmail(emailResult, email, name, text, 'confirmation');
        }
      } catch (emailError: any) {
        console.error('Failed to send confirmation email:', emailError.message);

        if (fallbackService) {
          await fallbackService.handleFailedEmail({
            success: false,
            error: emailError.message,
            timestamp: new Date().toISOString()
          }, email, name, text, 'confirmation');
        }
      }
    }

    res.status(200).json({
      success: true,
      message: 'Support request sent successfully'
    });

  } catch (error: any) {

    if (error.response?.error_code === 400) {
      res.status(503).json({
        error: 'Service temporarily unavailable. Please try again later.'
      });
    } else if (error.response?.error_code === 429) {
      res.status(503).json({
        error: 'Service is busy. Please try again in a few minutes.'
      });
    } else {
      res.status(500).json({
        error: 'Failed to send support request. Please try again later.'
      });
    }
  }
});

interface HealthResponse {
  status: string;
  timestamp: string;
}

app.get('/health', (req: Request, res: Response<HealthResponse>) => {
  res.status(200).json({
    status: 'OK',
    timestamp: new Date().toISOString()
  });
});

app.get('/token/status', async (req: Request, res: Response) => {
  try {
    const tokenStatus = await quickTokenCheck();
    res.status(200).json(tokenStatus);
  } catch (error: any) {
    res.status(500).json({
      error: 'Failed to check token status',
      message: error.message,
      timestamp: new Date().toISOString()
    });
  }
});

app.listen(PORT, () => {
    const isProduction = process.env.NODE_ENV === 'production';

    let baseUrl = process.env.BASE_URL;

    if (!baseUrl) {
        if (isProduction) {
            const domain = process.env.DOMAIN || 'api.blockroyale.biz';
            baseUrl = `https://${domain}`;
        } else {
            baseUrl = `http://localhost:${PORT}`;
        }
    }

    const webhookUrl = `${baseUrl}/webhook/support`;

    console.log(`Support bot server running on port ${PORT}`);
    console.log(`Environment: ${isProduction ? 'production' : 'development'}`);
    console.log(`Base URL: ${baseUrl}`);
    console.log(`Webhook endpoint: ${webhookUrl}`);

    if (gmailService) {
    console.log('✅ Gmail service initialized');

    if (fallbackService) {
      startAutoRetry(gmailService, 30);
    }
  } else {
    console.log('⚠️  Gmail service not configured');

    // Send Telegram notification about missing Gmail configuration
    sendGmailNotConfiguredNotification(baseUrl).catch(err => {
      console.error('Failed to send notification:', err.message);
    });
  }

  if (fallbackService) {
    console.log('✅ Email fallback service initialized');
  } else {
    console.log('⚠️  Email fallback service not configured');
  }

  console.log('\n📧 Gmail Setup:');
  console.log(`OAuth2 Auth: ${webhookUrl.replace('/webhook/support', '/oauth/auth')}`);
  console.log(`OAuth2 Test: ${webhookUrl.replace('/webhook/support', '/oauth/test')}`);
  console.log('Token status check: /token/status');
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
