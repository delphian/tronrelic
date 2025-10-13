import type { Redis as RedisClient } from 'ioredis';
import { v4 as uuid } from 'uuid';
import { ChatMessageModel, type ChatMessageDoc } from '../../database/models/chat-message-model.js';
import { CacheService } from '../../services/cache.service.js';
import { SignatureService } from '../auth/signature.service.js';
import { NotificationService } from '../../services/notification.service.js';
import type { ChatUpdatePayload } from '@tronrelic/shared';
import { ModerationService } from '../moderation/moderation.service.js';
import { RateLimitError, ValidationError } from '../../lib/errors.js';
import { env } from '../../config/env.js';

interface ChatMessageResponse {
  messageId: string;
  wallet: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ChatMeta {
  wallet: string;
  rateLimit: {
    limit: number;
    used: number;
    remaining: number;
    resetsAt: Date;
  };
  mute: {
    active: boolean;
    scopes: string[];
  };
  ignoreList: string[];
}

export class ChatService {
  private readonly cache: CacheService;
  private readonly signatureService = new SignatureService();
  private readonly notificationService = new NotificationService();
  private readonly moderationService = new ModerationService();
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
    this.cache = new CacheService(redis);
  }

  async list(wallet?: string) {
    const cacheKey = 'chat:messages';
    const cached = await this.cache.get<ChatMessageResponse[]>(cacheKey);

    let baseMessages: ChatMessageResponse[];
    if (cached) {
      baseMessages = cached.map(msg => ({
        ...msg,
        createdAt: new Date(msg.createdAt),
        updatedAt: new Date(msg.updatedAt)
      }));
    } else {
      const docs = (await ChatMessageModel.find({ 'flags.deleted': false, 'flags.spam': false })
        .sort({ updatedAt: -1 })
        .limit(500)
        .lean()) as ChatMessageDoc[];
      baseMessages = docs.map(doc => this.sanitizeMessage(doc));
      await this.cache.set(cacheKey, baseMessages, 10, ['chat']);
    }

    const normalizedWallet = wallet ? this.safeNormalizeWallet(wallet) : undefined;
      const ignoreList: string[] | undefined = normalizedWallet
        ? (await this.moderationService.listIgnoreEntries(normalizedWallet, 'chat')).map(
            entry => entry.ignoredWallet
          )
        : undefined;
    const ignoreSet = ignoreList ? new Set(ignoreList) : null;

    const messages = ignoreSet ? baseMessages.filter(msg => !ignoreSet.has(msg.wallet)) : baseMessages;
    const meta = normalizedWallet ? await this.buildMeta(normalizedWallet, ignoreList) : undefined;

    return { messages, meta };
  }

  async upsertMessage(wallet: string, message: string, signature: string) {
    const normalized = await this.signatureService.verifyMessage(wallet, message, signature);

    if (await this.moderationService.isWalletMuted(normalized, 'chat')) {
      throw new ValidationError('Wallet is muted for chat');
    }

    const rateLimit = await this.consumeDailyAllowance(normalized);
    if (!rateLimit.allowed) {
      throw new RateLimitError('Daily chat limit reached');
    }

    const existing = await ChatMessageModel.findOne({ wallet: normalized });
    const messageId = existing?.messageId ?? uuid();
    const doc = await ChatMessageModel.findOneAndUpdate(
      { wallet: normalized },
      { messageId, message, signature },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );

    await this.cache.invalidate('chat');

    const payload: ChatUpdatePayload = {
      event: 'chat:update',
      payload: {
        messageId,
        wallet: normalized,
        message,
        updatedAt: doc.updatedAt.toISOString()
      }
    };

    await this.notificationService.broadcast(payload);
    const meta = await this.buildMeta(normalized);
    return { message: this.sanitizeMessage(doc.toObject()), meta };
  }

  private sanitizeMessage(doc: ChatMessageDoc): ChatMessageResponse {
    return {
      messageId: doc.messageId,
      wallet: doc.wallet,
      message: doc.message,
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt
    };
  }

  private getCounterKey(wallet: string) {
    const today = new Date();
    const keyDate = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;
    return `chat:daily:${wallet}:${keyDate}`;
  }

  private async consumeDailyAllowance(wallet: string) {
    const key = this.getCounterKey(wallet);
    const limit = env.CHAT_DAILY_LIMIT;
    const now = Date.now();
    const pipeline = this.redis.multi();
    pipeline.incr(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();

    const used = results && typeof results[0]?.[1] === 'number' ? (results[0][1] as number) : 0;
    let ttlSeconds = results && typeof results[1]?.[1] === 'number' ? (results[1][1] as number) : -1;

    if (used === 1 || ttlSeconds < 0) {
      const secondsUntilEndOfDay = Math.max(1, Math.ceil((this.getEndOfDay().getTime() - now) / 1000));
      await this.redis.expire(key, secondsUntilEndOfDay);
      ttlSeconds = secondsUntilEndOfDay;
    }

    let effectiveUsed = used;
    const allowed = used <= limit;
    if (!allowed) {
      await this.redis.decr(key);
      effectiveUsed = limit;
    }

    return {
      allowed,
      meta: {
        limit,
        used: effectiveUsed,
        remaining: Math.max(limit - effectiveUsed, 0),
        resetsAt: new Date(now + ttlSeconds * 1000)
      }
    };
  }

  private async buildMeta(wallet: string, ignorePrefetch?: string[]): Promise<ChatMeta> {
    const key = this.getCounterKey(wallet);
    const limit = env.CHAT_DAILY_LIMIT;
    const results = await this.redis.multi().get(key).ttl(key).exec();
    const used = results && typeof results[0]?.[1] === 'string' ? Number(results[0][1]) : 0;
    const ttlSeconds = results && typeof results[1]?.[1] === 'number' ? (results[1][1] as number) : -1;
    const resetsAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : this.getEndOfDay();
    const mutes = await this.moderationService.listActiveMutes(wallet);
    const ignoreList: string[] = ignorePrefetch ??
      (await this.moderationService.listIgnoreEntries(wallet, 'chat')).map(entry => entry.ignoredWallet);
    const uniqueIgnore = [...new Set(ignoreList)];

    return {
      wallet,
      rateLimit: {
        limit,
        used,
        remaining: Math.max(limit - used, 0),
        resetsAt
      },
      mute: {
        active: mutes.length > 0,
        scopes: mutes.map(entry => entry.scope)
      },
      ignoreList: uniqueIgnore
    };
  }

  private getEndOfDay() {
    const end = new Date();
    end.setUTCHours(23, 59, 59, 999);
    return end;
  }

  private safeNormalizeWallet(wallet: string) {
    try {
      return this.signatureService.normalizeAddress(wallet);
    } catch (error) {
      return undefined;
    }
  }

  async updateIgnoreList(wallet: string, targetWallet: string, action: 'add' | 'remove', message: string, signature: string) {
    const normalizedTarget = this.signatureService.normalizeAddress(targetWallet);
    const expected = `CHAT_IGNORE:${normalizedTarget}:${action.toUpperCase()}`;
    if (message !== expected) {
      throw new ValidationError('Ignore list signature mismatch');
    }

    const normalized = await this.signatureService.verifyMessage(wallet, message, signature);

    if (action === 'add') {
      await this.moderationService.addIgnoreEntry(normalized, normalizedTarget, 'chat');
    } else {
      await this.moderationService.removeIgnoreEntry(normalized, normalizedTarget, 'chat');
    }

    const entries = await this.moderationService.listIgnoreEntries(normalized, 'chat');
    return entries.map(entry => entry.ignoredWallet);
  }

  async listIgnoreEntries(wallet: string) {
    const normalized = this.safeNormalizeWallet(wallet);
    if (!normalized) {
      throw new ValidationError('Invalid wallet address');
    }

    const entries = await this.moderationService.listIgnoreEntries(normalized, 'chat');
    return entries.map(entry => entry.ignoredWallet);
  }
}
