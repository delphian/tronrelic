import type { Request, Response } from 'express';
import { TelegramUserModel } from '../../database/models/telegram-user-model.js';
import { TelegramService } from '../../services/telegram.service.js';
import { telegramConfig } from '../../config/telegram.js';
import { logger } from '../../lib/logger.js';

interface TelegramUser {
  id: number;
  username?: string;
  first_name?: string;
  last_name?: string;
  language_code?: string;
}

interface TelegramChat {
  id: number | string;
  type: string;
}

interface TelegramMessage {
  message_id: number;
  date: number;
  chat: TelegramChat;
  from?: TelegramUser;
  text?: string;
}

interface TelegramCallbackQuery {
  id: string;
  from: TelegramUser;
  data?: string;
  message?: TelegramMessage;
}

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
  callback_query?: TelegramCallbackQuery;
}

interface InlineKeyboardButton {
  text: string;
  callback_data?: string;
  url?: string;
}

interface InlineKeyboardMarkup {
  inline_keyboard: InlineKeyboardButton[][];
}

type TelegramConfig = typeof telegramConfig;

interface TelegramControllerDependencies {
  telegram?: TelegramService;
  userModel?: typeof TelegramUserModel;
  config?: TelegramConfig;
}

export class TelegramController {
  private readonly telegram: TelegramService;
  private readonly userModel: typeof TelegramUserModel;
  private readonly config: TelegramConfig;

  constructor(deps: TelegramControllerDependencies = {}) {
    this.telegram = deps.telegram ?? new TelegramService();
    this.userModel = deps.userModel ?? TelegramUserModel;
    this.config = deps.config ?? telegramConfig;
  }

  webhook = async (req: Request, res: Response) => {
    if (!this.isSecretValid(req)) {
      logger.warn('Rejected Telegram webhook due to secret mismatch');
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }

    if (!this.isIpAllowed(req)) {
      const ip = this.extractClientIp(req) ?? 'unknown';
      logger.warn({ ip, allowlist: this.config.allowlist }, 'Rejected Telegram webhook due to IP allowlist');
      res.status(403).json({ ok: false, error: 'Forbidden' });
      return;
    }

    const update = req.body as TelegramUpdate | undefined;

    try {
      if (update?.message) {
        await this.handleMessage(update.message);
      } else if (update?.callback_query) {
        await this.handleCallback(update.callback_query);
      } else {
        logger.debug({ update }, 'Ignoring unsupported Telegram update');
      }
    } catch (error) {
      logger.error({ error, update }, 'Failed to process Telegram update');
    }

    res.json({ ok: true });
  };

  private isSecretValid(req: Request): boolean {
    if (!this.config.webhookSecret) {
      return true;
    }
    const header = req.headers['x-telegram-bot-api-secret-token'];
    const token = Array.isArray(header) ? header[0] : header;
    return token === this.config.webhookSecret;
  }

  private extractClientIp(req: Request): string | undefined {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim().length) {
      const parts = forwarded.split(',');
      if (parts.length) {
        return parts[0]?.trim();
      }
    }

    const cfConnectingIp = req.headers['cf-connecting-ip'];
    if (typeof cfConnectingIp === 'string') {
      return cfConnectingIp;
    }

    return req.ip;
  }

  private isIpAllowed(req: Request): boolean {
    const ip = this.extractClientIp(req);
    return this.config.isIpAllowed(ip);
  }

  private async handleMessage(message: TelegramMessage) {
    const { from, chat, text } = message;

    if (from) {
      await this.ensureUser(from);
    }

    if (!from || !text) {
      return;
    }

    const command = this.parseCommand(text);
    const chatId = this.getChatId(chat);

    switch (command) {
      case '/start':
        await this.handleStart(chatId, from);
        break;
      case '/tap':
        await this.handleTap(chatId, from);
        break;
      case '/game':
        await this.handleGame(chatId);
        break;
      default:
        logger.debug({ command, chatId }, 'Unhandled Telegram command');
    }
  }

  private async handleCallback(query: TelegramCallbackQuery) {
    const { from, data } = query;
    await this.ensureUser(from);

    switch (data) {
      case 'action:tap': {
        const score = await this.incrementScore(from);
        await this.telegram.answerCallbackQuery(query.id, `⚡️ Score: ${score}`);
        break;
      }
      case 'action:game': {
        await this.telegram.answerCallbackQuery(query.id, 'Launching mini-app…');
        if (query.message?.chat) {
          await this.handleGame(this.getChatId(query.message.chat));
        }
        break;
      }
      default:
        await this.telegram.answerCallbackQuery(query.id);
        logger.debug({ data }, 'Ignored Telegram callback action');
    }
  }

  private async handleStart(chatId: string, user: TelegramUser) {
    const displayName = this.getDisplayName(user);
    const welcome = [
      `👋 Welcome ${displayName}!`,
      'Stay tuned for TronRelic alerts and use the buttons below to interact.'
    ].join('\n');

    await this.telegram.sendMessage(chatId, welcome, {
      replyMarkup: this.buildPrimaryKeyboard(),
      disablePreview: true
    });
  }

  private async handleTap(chatId: string, user: TelegramUser) {
    const score = await this.incrementScore(user);
    const displayName = this.getDisplayName(user);
    const message = `⚡️ ${displayName} tapped! Score: ${score}`;

    await this.telegram.sendMessage(chatId, message, {
      replyMarkup: this.buildPrimaryKeyboard(),
      disablePreview: true,
      parseMode: null
    });
  }

  private async handleGame(chatId: string) {
    if (!this.config.miniAppUrl) {
      await this.telegram.sendMessage(chatId, 'Mini-app link is not configured yet. Check back soon!', {
        disablePreview: true,
        parseMode: null
      });
      return;
    }

    await this.telegram.sendMessage(chatId, '🎮 Launch the TronRelic mini-app:', {
      disablePreview: true,
      parseMode: null,
      replyMarkup: {
        inline_keyboard: [[{ text: 'Open Mini-App', url: this.config.miniAppUrl }]]
      }
    });
  }

  private buildPrimaryKeyboard(): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [[{ text: '⚡️ Tap', callback_data: 'action:tap' }]];

    if (this.config.miniAppUrl) {
      keyboard[0].push({ text: 'Launch Mini-App', url: this.config.miniAppUrl });
    }

    return { inline_keyboard: keyboard };
  }

  private parseCommand(text: string): string {
    if (!text.startsWith('/')) {
      return '';
    }
    const [first] = text.trim().split(/\s+/u);
    const [command] = first.split('@');
    return command.toLowerCase();
  }

  private getChatId(chat: TelegramChat): string {
    return String(chat.id);
  }

  private async ensureUser(user: TelegramUser) {
    const now = new Date();
    await this.userModel.updateOne(
      { telegramId: user.id },
      {
        username: user.username,
        firstName: user.first_name,
        lastName: user.last_name,
        languageCode: user.language_code,
        lastInteraction: now
      },
      { upsert: true }
    );
  }

  private async incrementScore(user: TelegramUser): Promise<number> {
    const now = new Date();
    const document = await this.userModel.findOneAndUpdate(
      { telegramId: user.id },
      {
        $inc: { score: this.config.tapIncrement },
        $set: {
          username: user.username,
          firstName: user.first_name,
          lastName: user.last_name,
          languageCode: user.language_code,
          lastInteraction: now
        }
      },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );

    return document?.score ?? this.config.tapIncrement;
  }

  private getDisplayName(user: TelegramUser): string {
    if (user.username) {
      return `@${user.username}`;
    }
    if (user.first_name || user.last_name) {
      return [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
    }
    return `User ${user.id}`;
  }
}
