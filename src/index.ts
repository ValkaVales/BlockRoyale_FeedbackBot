import dotenv from 'dotenv';
import express, { Request, Response } from 'express';
import cors from 'cors';
import rateLimit from 'express-rate-limit';
import { Telegraf } from 'telegraf';
import { SupportRequest, ApiResponse, ErrorResponse } from './types';

dotenv.config();

const app = express();
const PORT: number = parseInt(process.env.PORT || '3000', 10);

const BOT_TOKEN = process.env.BOT_TOKEN;
const CHAT_ID = process.env.CHAT_ID;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET;

if (!BOT_TOKEN || !CHAT_ID || !WEBHOOK_SECRET) {
  console.error('Error: BOT_TOKEN, CHAT_ID and WEBHOOK_SECRET must be provided in environment variables');
  process.exit(1);
}

const bot = new Telegraf(BOT_TOKEN);

app.use(cors({
  origin: [
    'https://gpnnmlgcha.a.pinggy.link',
    'http://localhost:3000',
    'http://localhost:8080',
    /\.pinggy\.link$/,
    /\.ngrok\.io$/,
    /\.herokuapp\.com$/
  ],
  methods: ['GET', 'POST'],
  allowedHeaders: ['Content-Type', 'X-Webhook-Secret', 'Authorization'],
  credentials: true
}));

app.use(express.json());

const supportRateLimit = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 2,
  message: {
    error: 'Rate limit exceeded. You can send maximum 2 support requests per 10 minutes. Please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
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
): Promise<void> {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      await bot.telegram.sendMessage(chatId, message, options);
      console.log(`Message sent successfully on attempt ${attempt}`);
      return;
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

interface SupportRequestBody extends SupportRequest {}

app.post('/webhook/support', supportRateLimit, async (req: Request<{}, ApiResponse | ErrorResponse, SupportRequestBody>, res: Response<ApiResponse | ErrorResponse>) => {
  try {
    if (!authenticateWebhook(req)) {
      return res.status(401).json({
        error: 'Unauthorized: Invalid webhook secret'
      });
    }

    const { name, email, text } = req.body;

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

    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(email)}`;

    await sendMessageWithRetry(bot, CHAT_ID, message, {
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

app.listen(PORT, () => {
  const isProduction = process.env.NODE_ENV === 'production';
  const appName = process.env.HEROKU_APP_NAME;

  let webhookUrl;
  if (isProduction && appName) {
    webhookUrl = `https://${appName}.herokuapp.com/webhook/support`;
  } else if (isProduction) {
    webhookUrl = `https://blockroyale-support-bot-93d8c4fffe63.herokuapp.com`;
  } else {
    webhookUrl = `http://localhost:${PORT}/webhook/support`;
  }

  console.log(`Support bot server running on port ${PORT}`);
  console.log(`Environment: ${isProduction ? 'production' : 'development'}`);
  console.log(`Webhook endpoint: ${webhookUrl}`);
});

process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

process.on('uncaughtException', (error: Error) => {
  console.error('Uncaught Exception:', error);
  process.exit(1);
});
