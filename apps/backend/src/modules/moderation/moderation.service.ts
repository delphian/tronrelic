import { randomUUID } from 'node:crypto';
import { CommentModel } from '../../database/models/comment-model.js';
import { ChatMessageModel } from '../../database/models/chat-message-model.js';
import { MuteModel, type MuteScope } from '../../database/models/mute-model.js';
import { ModerationEventModel, type ModerationAction, type ModerationTargetType } from '../../database/models/moderation-event-model.js';
import { IgnoreEntryModel, type IgnoreEntryDoc, type IgnoreScope } from '../../database/models/ignore-list-model.js';
import { StorageService } from '../../services/storage.service.js';
import { CacheService } from '../../services/cache.service.js';
import { logger } from '../../lib/logger.js';
import { getRedisClient } from '../../loaders/redis.js';
import type { FilterQuery } from 'mongoose';

export interface ModerationMutationOptions {
  performedBy: string;
  reason?: string;
}

export class ModerationService {
  private readonly cache = new CacheService(getRedisClient());

  async muteWallet(wallet: string, scope: MuteScope, { performedBy, reason }: ModerationMutationOptions, expiresAt?: Date) {
    await MuteModel.updateOne(
      { wallet, scope },
      { wallet, scope, reason, expiresAt, createdBy: performedBy },
      { upsert: true }
    );
    await this.recordEvent('mute', 'wallet', wallet, performedBy, { scope, reason, expiresAt });
    await this.cache.invalidate(`wallet:${wallet}:mutes`);
  }

  async unmuteWallet(wallet: string, scope: MuteScope, performedBy: string) {
    await MuteModel.deleteOne({ wallet, scope });
    await this.recordEvent('unmute', 'wallet', wallet, performedBy, { scope });
    await this.cache.invalidate(`wallet:${wallet}:mutes`);
  }

  async isWalletMuted(wallet: string, scope: MuteScope) {
    const now = new Date();
    const entries = await MuteModel.find({ wallet, $or: [{ scope }, { scope: 'all' }] });
    return entries.some(entry => !entry.expiresAt || entry.expiresAt > now);
  }

  async listActiveMutes(wallet: string) {
    const now = new Date();
    return MuteModel.find({ wallet, $or: [{ expiresAt: null }, { expiresAt: { $gt: now } }] }).lean();
  }

  async listMutes(scope?: MuteScope) {
    const filter: Record<string, unknown> = {};
    if (scope && scope !== 'all') {
      filter.$or = [{ scope }, { scope: 'all' }];
    }

    return MuteModel.find(filter).sort({ createdAt: -1 }).lean();
  }

  async deleteComment(commentId: string, { performedBy, reason }: ModerationMutationOptions) {
    const comment = await CommentModel.findOneAndUpdate(
      { commentId },
      {
        $set: {
          'flags.deleted': true,
          'flags.moderated': true,
          ...(reason ? { 'moderation.deletedReason': reason } : {}),
          'moderation.deletedAt': new Date(),
          'moderation.deletedBy': performedBy
        },
        ...(reason ? {} : { $unset: { 'moderation.deletedReason': '' } })
      },
      { new: true }
    );

    if (!comment) {
      return null;
    }

    await Promise.all(comment.attachments.map(attachment => StorageService.deleteObject(attachment.storageKey)));
    await this.recordEvent('delete', 'comment', comment.commentId, performedBy, { reason });
    await this.invalidateComments(comment.threadId);
    return comment.toObject();
  }

  async restoreComment(commentId: string, performedBy: string) {
    const comment = await CommentModel.findOneAndUpdate(
      { commentId },
      {
        $set: {
          'flags.deleted': false
        },
        $unset: {
          'moderation.deletedAt': '',
          'moderation.deletedBy': '',
          'moderation.deletedReason': ''
        }
      },
      { new: true }
    );

    if (!comment) {
      return null;
    }

    await this.recordEvent('restore', 'comment', comment.commentId, performedBy);
    await this.invalidateComments(comment.threadId);
    return comment.toObject();
  }

  async flagCommentSpam(commentId: string, { performedBy, reason }: ModerationMutationOptions) {
    const comment = await CommentModel.findOneAndUpdate(
      { commentId },
      {
        $set: {
          'flags.spam': true,
          'flags.moderated': true,
          ...(reason ? { 'moderation.spamReason': reason } : {}),
          'moderation.spamAt': new Date(),
          'moderation.spamBy': performedBy
        },
        ...(reason ? {} : { $unset: { 'moderation.spamReason': '' } })
      },
      { new: true }
    );

    if (!comment) {
      return null;
    }

    await this.recordEvent('flag-spam', 'comment', comment.commentId, performedBy, { reason });
    await this.invalidateComments(comment.threadId);
    return comment.toObject();
  }

  async unflagCommentSpam(commentId: string, performedBy: string) {
    const comment = await CommentModel.findOneAndUpdate(
      { commentId },
      {
        $set: {
          'flags.spam': false
        },
        $unset: {
          'moderation.spamAt': '',
          'moderation.spamBy': '',
          'moderation.spamReason': ''
        }
      },
      { new: true }
    );

    if (!comment) {
      return null;
    }

    await this.recordEvent('unflag-spam', 'comment', comment.commentId, performedBy);
    await this.invalidateComments(comment.threadId);
    return comment.toObject();
  }

  async deleteChatMessage(messageId: string, { performedBy, reason }: ModerationMutationOptions) {
    const message = await ChatMessageModel.findOneAndUpdate(
      { messageId },
      {
        $set: {
          'flags.deleted': true,
          'flags.moderated': true,
          ...(reason ? { 'moderation.deletedReason': reason } : {}),
          'moderation.deletedAt': new Date(),
          'moderation.deletedBy': performedBy
        },
        ...(reason ? {} : { $unset: { 'moderation.deletedReason': '' } })
      },
      { new: true }
    );

    if (!message) {
      return null;
    }

    await this.recordEvent('delete', 'chat', message.messageId, performedBy, { reason });
    await this.invalidateChat();
    return message.toObject();
  }

  async restoreChatMessage(messageId: string, performedBy: string) {
    const message = await ChatMessageModel.findOneAndUpdate(
      { messageId },
      {
        $set: {
          'flags.deleted': false
        },
        $unset: {
          'moderation.deletedAt': '',
          'moderation.deletedBy': '',
          'moderation.deletedReason': ''
        }
      },
      { new: true }
    );

    if (!message) {
      return null;
    }

    await this.recordEvent('restore', 'chat', message.messageId, performedBy);
    await this.invalidateChat();
    return message.toObject();
  }

  async flagChatSpam(messageId: string, { performedBy, reason }: ModerationMutationOptions) {
    const message = await ChatMessageModel.findOneAndUpdate(
      { messageId },
      {
        $set: {
          'flags.spam': true,
          'flags.moderated': true,
          ...(reason ? { 'moderation.spamReason': reason } : {}),
          'moderation.spamAt': new Date(),
          'moderation.spamBy': performedBy
        },
        ...(reason ? {} : { $unset: { 'moderation.spamReason': '' } })
      },
      { new: true }
    );

    if (!message) {
      return null;
    }

    await this.recordEvent('flag-spam', 'chat', message.messageId, performedBy, { reason });
    await this.invalidateChat();
    return message.toObject();
  }

  async unflagChatSpam(messageId: string, performedBy: string) {
    const message = await ChatMessageModel.findOneAndUpdate(
      { messageId },
      {
        $set: {
          'flags.spam': false
        },
        $unset: {
          'moderation.spamAt': '',
          'moderation.spamBy': '',
          'moderation.spamReason': ''
        }
      },
      { new: true }
    );

    if (!message) {
      return null;
    }

    await this.recordEvent('unflag-spam', 'chat', message.messageId, performedBy);
    await this.invalidateChat();
    return message.toObject();
  }

  async listSpamQueue() {
    const [comments, chatMessages] = await Promise.all([
      CommentModel.find({ 'flags.spam': true, 'flags.deleted': false }).sort({ createdAt: -1 }).lean(),
      ChatMessageModel.find({ 'flags.spam': true, 'flags.deleted': false }).sort({ createdAt: -1 }).lean()
    ]);

    return {
      comments,
      chatMessages
    };
  }

  async addIgnoreEntry(ownerWallet: string, ignoredWallet: string, scope: IgnoreScope, performedBy?: string) {
    await IgnoreEntryModel.updateOne({ ownerWallet, ignoredWallet, scope }, { ownerWallet, ignoredWallet, scope }, { upsert: true });

    if (performedBy) {
      await this.recordEvent('ignore-add', 'wallet', `${ownerWallet}:${ignoredWallet}`, performedBy, { scope });
    }
  }

  async removeIgnoreEntry(ownerWallet: string, ignoredWallet: string, scope: IgnoreScope, performedBy?: string) {
    await IgnoreEntryModel.deleteOne({ ownerWallet, ignoredWallet, scope });

    if (performedBy) {
      await this.recordEvent('ignore-remove', 'wallet', `${ownerWallet}:${ignoredWallet}`, performedBy, { scope });
    }
  }

  async listIgnoreEntries(ownerWallet: string, scope?: IgnoreScope): Promise<IgnoreEntryDoc[]> {
    const filter: FilterQuery<IgnoreEntryDoc> = { ownerWallet };
    if (scope) {
      filter.$or = [{ scope }, { scope: 'all' }];
    }
    return IgnoreEntryModel.find(filter).lean().exec() as Promise<IgnoreEntryDoc[]>;
  }

  private async invalidateComments(threadId: string) {
    await this.cache.invalidate(`comments:${threadId}`);
  }

  private async invalidateChat() {
    await this.cache.invalidate('chat');
  }

  private async recordEvent(action: ModerationAction, targetType: ModerationTargetType, targetId: string, performedBy: string, metadata?: Record<string, unknown>) {
    try {
      await ModerationEventModel.create({
        eventId: randomUUID(),
        action,
        targetType,
        targetId,
        performedBy,
        metadata
      });
    } catch (error) {
      logger.error({ error, action, targetType, targetId }, 'Failed to record moderation event');
    }
  }
}
