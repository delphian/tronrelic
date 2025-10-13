import type { Redis as RedisClient } from 'ioredis';
import { BookmarkModel, type BookmarkDoc } from '../../database/models/index.js';
import { CacheService } from '../../services/cache.service.js';
import { SignatureService } from '../auth/signature.service.js';
import { ValidationError } from '../../lib/errors.js';

export interface BookmarkPayload {
  ownerWallet: string;
  targetWallet: string;
  label?: string;
  message: string;
  signature: string;
}

export class BookmarkService {
  private readonly cache: CacheService;
  private readonly signature = new SignatureService();

  constructor(redis: RedisClient) {
    this.cache = new CacheService(redis);
  }

  async list(ownerWallet: string) {
    const normalized = this.normalizeWallet(ownerWallet);
    const cacheKey = `accounts:bookmarks:${normalized}`;
    const cached = await this.cache.get<BookmarkDoc[]>(cacheKey);
    if (cached) {
      return cached;
    }

    const entries = await BookmarkModel.find({ ownerWallet: normalized }).sort({ createdAt: -1 }).lean();
    await this.cache.set(cacheKey, entries, 60, ['accounts-bookmarks']);
    return entries;
  }

  async upsert(payload: BookmarkPayload) {
    const ownerWallet = this.normalizeWallet(payload.ownerWallet);
    const targetWallet = this.normalizeWallet(payload.targetWallet);

    await this.verifySignature(ownerWallet, payload.message, payload.signature, targetWallet);

    await BookmarkModel.updateOne(
      { ownerWallet, targetWallet },
      {
        ownerWallet,
        targetWallet,
        label: payload.label ?? null,
        updatedAt: new Date()
      },
      { upsert: true }
    );

    await this.cache.invalidate(`accounts:bookmarks:${ownerWallet}`);

    return this.list(ownerWallet);
  }

  async remove(payload: BookmarkPayload) {
    const ownerWallet = this.normalizeWallet(payload.ownerWallet);
    const targetWallet = this.normalizeWallet(payload.targetWallet);

    await this.verifySignature(ownerWallet, payload.message, payload.signature, targetWallet);

    await BookmarkModel.deleteOne({ ownerWallet, targetWallet });
    await this.cache.invalidate(`accounts:bookmarks:${ownerWallet}`);

    return this.list(ownerWallet);
  }

  private async verifySignature(ownerWallet: string, message: string, signature: string, targetWallet: string) {
    if (!message?.includes(targetWallet)) {
      throw new ValidationError('Message must reference target wallet');
    }

    const normalized = await this.signature.verifyMessage(ownerWallet, message, signature);
    if (normalized !== ownerWallet) {
      throw new ValidationError('Signature wallet mismatch');
    }
  }

  private normalizeWallet(wallet: string) {
    if (!wallet || typeof wallet !== 'string') {
      throw new ValidationError('Wallet is required');
    }
    const trimmed = wallet.trim();
    if (!trimmed.startsWith('T')) {
      throw new ValidationError('Wallet must be a base58 TRON address');
    }
    return trimmed;
  }
}
