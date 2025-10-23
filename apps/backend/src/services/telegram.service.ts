import axios from 'axios';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { retry } from '../lib/retry.js';

export interface TelegramSendOptions {
  parseMode?: 'MarkdownV2' | 'HTML' | null;
  threadId?: number;
  disablePreview?: boolean;
  replyMarkup?: unknown;
}

export class TelegramService {
  private readonly token = env.TELEGRAM_BOT_TOKEN;
  private readonly maxRetries = 3; // Default max retries
  private readonly retryDelayMs = 500; // Default retry delay (500ms)

  private buildUrl(method: string) {
    return `https://api.telegram.org/bot${this.token}/${method}`;
  }

  async sendMessage(chatId: string, text: string, options: TelegramSendOptions = {}) {
    if (!this.token) {
      logger.warn('Telegram token not configured; skipping send');
      return;
    }

    const { parseMode, threadId, disablePreview, replyMarkup } = options;
    const payload: Record<string, unknown> = {
      chat_id: chatId,
      text
    };

    if (threadId !== undefined) {
      payload.message_thread_id = threadId;
    }

    if (parseMode === undefined) {
      payload.parse_mode = 'MarkdownV2';
    } else if (parseMode) {
      payload.parse_mode = parseMode;
    }

    if (disablePreview !== undefined) {
      payload.disable_web_page_preview = disablePreview;
    }

    if (replyMarkup !== undefined) {
      payload.reply_markup = replyMarkup;
    }

    try {
      await retry(
        async () => {
          await axios.post(this.buildUrl('sendMessage'), payload);
        },
        {
          retries: this.maxRetries,
          delayMs: this.retryDelayMs,
          onRetry: (attempt, error) => {
            logger.warn({ attempt, error }, 'Retrying Telegram sendMessage');
          }
        }
      );
    } catch (error) {
      logger.error({ error }, 'Failed to send Telegram message');
      throw error;
    }
  }

  async answerCallbackQuery(callbackId: string, text?: string, showAlert = false) {
    if (!this.token) {
      logger.warn('Telegram token not configured; skipping callback response');
      return;
    }

    const payload: Record<string, unknown> = {
      callback_query_id: callbackId
    };

    if (text) {
      payload.text = text;
    }

    if (showAlert) {
      payload.show_alert = true;
    }

    try {
      await retry(
        async () => {
          await axios.post(this.buildUrl('answerCallbackQuery'), payload);
        },
        {
          retries: this.maxRetries,
          delayMs: this.retryDelayMs,
          onRetry: (attempt, error) => {
            logger.warn({ attempt, error }, 'Retrying Telegram answerCallbackQuery');
          }
        }
      );
    } catch (error) {
      logger.error({ error }, 'Failed to answer Telegram callback query');
      throw error;
    }
  }
}
