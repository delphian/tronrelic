import { v4 as uuid } from 'uuid';
import type { Redis as RedisClient } from 'ioredis';
import { CommentModel, type CommentDoc } from '../../database/models/comment-model.js';
import { CacheService } from '../../services/cache.service.js';
import { SignatureService } from '../auth/signature.service.js';
import { NotificationService } from '../../services/notification.service.js';
import type { CommentsUpdatePayload } from '@tronrelic/shared';
import { ModerationService } from '../moderation/moderation.service.js';
import { RateLimitError, ValidationError } from '../../lib/errors.js';
import { env } from '../../config/env.js';
import { StorageService } from '../../services/storage.service.js';

export interface CommentAttachmentInput {
  attachmentId: string;
  filename: string;
  storageKey: string;
  contentType: string;
  size: number;
}

export interface CommentListMeta {
  wallet?: string;
  rateLimit?: RateLimitMeta;
  mute?: {
    active: boolean;
    scopes: string[];
  };
  ignoreList?: string[];
}

interface SanitizedComment {
  commentId: string;
  threadId: string;
  wallet: string;
  message: string;
  createdAt: Date;
  updatedAt: Date;
  attachments: Array<{
    attachmentId: string;
    filename: string;
    contentType: string;
    size: number;
    url: string | null;
  }>;
}

interface RateLimitMeta {
  limit: number;
  used: number;
  remaining: number;
  resetsAt: Date;
}

export class CommentService {
  private readonly cache: CacheService;
  private readonly signatureService = new SignatureService();
  private readonly notificationService = new NotificationService();
  private readonly moderationService = new ModerationService();
  private readonly redis: RedisClient;

  constructor(redis: RedisClient) {
    this.redis = redis;
    this.cache = new CacheService(redis);
  }

  async list(threadId: string, wallet?: string) {
    const cacheKey = `comments:${threadId}`;
    const cacheTag = `comments:${threadId}`;
    const cached = await this.cache.get<CommentDoc[]>(cacheKey);
    let baseComments: CommentDoc[];
    if (cached) {
      baseComments = cached;
    } else {
      const docs = (await CommentModel.find({ threadId, 'flags.deleted': false, 'flags.spam': false })
        .sort({ createdAt: -1 })
        .lean()) as CommentDoc[];
      baseComments = docs;
      await this.cache.set(cacheKey, baseComments, 30, ['comments', cacheTag]);
    }

    const normalizedWallet = wallet ? this.safeNormalizeWallet(wallet) : undefined;
    const ignoreWallets: string[] | undefined = normalizedWallet
      ? (await this.moderationService.listIgnoreEntries(normalizedWallet, 'comments')).map(
          entry => entry.ignoredWallet
        )
      : undefined;
    const ignoreSet = ignoreWallets ? new Set(ignoreWallets) : null;

    const filtered = ignoreSet
      ? baseComments.filter((comment: CommentDoc) => !ignoreSet.has(comment.wallet))
      : baseComments;
    const comments = await Promise.all(filtered.map((comment: CommentDoc) => this.decorateComment(comment)));

    const meta = normalizedWallet ? await this.buildMeta(normalizedWallet, ignoreWallets) : undefined;
    return { comments, meta };
  }

  async addComment(
    threadId: string,
    wallet: string,
    message: string,
    signature: string,
    metadata?: { ip?: string; userAgent?: string },
    attachments?: CommentAttachmentInput[]
  ) {
    const normalized = await this.signatureService.verifyMessage(wallet, message, signature);

    if (await this.moderationService.isWalletMuted(normalized, 'comments')) {
      throw new ValidationError('Wallet is muted for comments');
    }

    const sanitizedAttachments = this.validateAttachments(normalized, attachments ?? []);

    const rateLimit = await this.consumeDailyAllowance(normalized);
    if (!rateLimit.allowed) {
      throw new RateLimitError('Daily comment limit reached');
    }

    const commentId = uuid();
    const comment = await CommentModel.create({
      threadId,
      commentId,
      wallet: normalized,
      message,
      signature,
      metadata: metadata ?? {},
      attachments: sanitizedAttachments,
      flags: {
        spam: false,
        moderated: false,
        deleted: false
      }
    });

    await this.cache.invalidate(`comments:${threadId}`);

    const decorated = await this.decorateComment(comment.toObject());
    const payload: CommentsUpdatePayload = {
      event: 'comments:new',
      payload: {
        threadId,
        commentId,
        message,
        wallet: normalized,
        createdAt: comment.createdAt.toISOString(),
        attachments: decorated.attachments
      }
    };

    await this.notificationService.broadcast(payload);
    const meta = await this.buildMeta(normalized);
    return { comment: decorated, meta };
  }

  async createAttachmentRequest(
    wallet: string,
    filename: string,
    contentType: string,
    size: number,
    message: string,
    signature: string
  ) {
    if (!StorageService.isEnabled()) {
      throw new ValidationError('Attachments are currently disabled');
    }

    if (size > env.COMMENTS_ATTACHMENT_MAX_SIZE) {
      throw new ValidationError('Attachment exceeds maximum allowed size');
    }

    const expectedMessage = `ATTACH:${filename}:${size}`;
    if (message !== expectedMessage) {
      throw new ValidationError('Attachment signature mismatch');
    }

    const normalized = await this.signatureService.verifyMessage(wallet, message, signature);

    const attachment = await StorageService.createSignedAttachment({
      wallet: normalized,
      filename,
      contentType,
      size
    });

    return {
      attachmentId: attachment.attachmentId,
      storageKey: attachment.storageKey,
      uploadUrl: attachment.uploadUrl,
      expiresAt: attachment.expiresAt
    };
  }

  async updateIgnoreList(wallet: string, targetWallet: string, action: 'add' | 'remove', message: string, signature: string) {
    const normalizedTarget = this.signatureService.normalizeAddress(targetWallet);
    const expectedMessage = `IGNORE:${normalizedTarget}:${action.toUpperCase()}`;
    if (message !== expectedMessage) {
      throw new ValidationError('Ignore list signature mismatch');
    }

    const normalized = await this.signatureService.verifyMessage(wallet, message, signature);

    if (action === 'add') {
      await this.moderationService.addIgnoreEntry(normalized, normalizedTarget, 'comments');
    } else {
      await this.moderationService.removeIgnoreEntry(normalized, normalizedTarget, 'comments');
    }

    const entries = await this.moderationService.listIgnoreEntries(normalized, 'comments');
    return entries.map(entry => entry.ignoredWallet);
  }

  async listIgnoreEntries(wallet: string) {
    const normalized = this.safeNormalizeWallet(wallet);
    if (!normalized) {
      throw new ValidationError('Invalid wallet address');
    }

    const entries = await this.moderationService.listIgnoreEntries(normalized, 'comments');
    return entries.map(entry => entry.ignoredWallet);
  }

  private validateAttachments(wallet: string, attachments: CommentAttachmentInput[]) {
    if (!attachments.length) {
      return [];
    }

    if (!StorageService.isEnabled()) {
      throw new ValidationError('Attachments are currently disabled');
    }

    const maxSize = env.COMMENTS_ATTACHMENT_MAX_SIZE;
    const seenIds = new Set<string>();

    for (const attachment of attachments) {
      if (attachment.size > maxSize) {
        throw new ValidationError('Attachment exceeds maximum allowed size', { attachmentId: attachment.attachmentId });
      }

      if (seenIds.has(attachment.attachmentId)) {
        throw new ValidationError('Duplicate attachment identifier provided', { attachmentId: attachment.attachmentId });
      }
      seenIds.add(attachment.attachmentId);

      if (!attachment.storageKey.startsWith(`comments/${wallet}/`)) {
        throw new ValidationError('Attachment not authorized for wallet', { attachmentId: attachment.attachmentId });
      }
    }

    return attachments.map(attachment => ({
      attachmentId: attachment.attachmentId,
      filename: attachment.filename,
      storageKey: attachment.storageKey,
      contentType: attachment.contentType,
      size: attachment.size
    }));
  }

  private async mapAttachmentsWithUrls(comment: CommentDoc) {
    if (!comment.attachments?.length) {
      return [];
    }

    return Promise.all(
      comment.attachments.map(async attachment => {
        let url: string | null = null;
        if (StorageService.isEnabled()) {
          try {
            url = await StorageService.getDownloadUrl(attachment.storageKey);
          } catch (error) {
            url = null;
          }
        }

        return {
          attachmentId: attachment.attachmentId,
          filename: attachment.filename,
          contentType: attachment.contentType,
          size: attachment.size,
          url
        };
      })
    );
  }

  private async decorateComment(comment: CommentDoc): Promise<SanitizedComment> {
    const attachments = await this.mapAttachmentsWithUrls(comment);
    return {
      commentId: comment.commentId,
      threadId: comment.threadId,
      wallet: comment.wallet,
      message: comment.message,
      createdAt: this.toDate(comment.createdAt),
      updatedAt: this.toDate(comment.updatedAt),
      attachments
    };
  }

  private getCounterKey(wallet: string) {
    const today = new Date();
    const keyDate = `${today.getUTCFullYear()}-${today.getUTCMonth()}-${today.getUTCDate()}`;
    return `comments:daily:${wallet}:${keyDate}`;
  }

  private async consumeDailyAllowance(wallet: string) {
    const key = this.getCounterKey(wallet);
    const limit = env.COMMENTS_DAILY_LIMIT;
    const now = Date.now();
    const pipeline = this.redis.multi();
    pipeline.incr(key);
    pipeline.ttl(key);
    const results = await pipeline.exec();

    const used = results && typeof results[0]?.[1] === 'string' ? Number(results[0][1]) : 0;
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

  private getEndOfDay() {
    const end = new Date();
    end.setUTCHours(23, 59, 59, 999);
    return end;
  }

  private async buildMeta(wallet: string, ignorePrefetch?: string[]): Promise<CommentListMeta> {
    const limitMeta = await this.getRateLimitMeta(wallet);
    const mutes = await this.moderationService.listActiveMutes(wallet);
    const ignoreList: string[] = ignorePrefetch ??
      (await this.moderationService.listIgnoreEntries(wallet, 'comments')).map(entry => entry.ignoredWallet);
    const uniqueIgnore = [...new Set(ignoreList)];

    return {
      wallet,
      rateLimit: limitMeta,
      mute: {
        active: mutes.length > 0,
        scopes: mutes.map(entry => entry.scope)
      },
      ignoreList: uniqueIgnore
    };
  }

  private async getRateLimitMeta(wallet: string): Promise<RateLimitMeta> {
    const limit = env.COMMENTS_DAILY_LIMIT;
    const key = this.getCounterKey(wallet);
    const results = await this.redis.multi().get(key).ttl(key).exec();
    const used = results && typeof results[0]?.[1] === 'string' ? Number(results[0][1]) : 0;
    const ttlSeconds = results && typeof results[1]?.[1] === 'number' ? (results[1][1] as number) : -1;
    const resetsAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000) : this.getEndOfDay();

    return {
      limit,
      used,
      remaining: Math.max(limit - used, 0),
      resetsAt
    };
  }

  private safeNormalizeWallet(wallet: string) {
    try {
      return this.signatureService.normalizeAddress(wallet);
    } catch (error) {
      return undefined;
    }
  }

  private toDate(value: Date | string): Date {
    return value instanceof Date ? value : new Date(value);
  }
}
