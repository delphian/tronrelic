import { Schema, model, type Document } from 'mongoose';

export interface CommentDoc extends Document {
  threadId: string;
  commentId: string;
  wallet: string;
  message: string;
  signature: string;
  attachments: Array<{
    attachmentId: string;
    filename: string;
    storageKey: string;
    contentType: string;
    size: number;
  }>;
  createdAt: Date;
  updatedAt: Date;
  metadata: {
    ip?: string;
    userAgent?: string;
  };
  flags: {
    spam: boolean;
    moderated: boolean;
    deleted: boolean;
  };
  moderation?: {
    deletedAt?: Date;
    deletedBy?: string;
    deletedReason?: string;
    spamAt?: Date;
    spamBy?: string;
    spamReason?: string;
  };
}

const CommentSchema = new Schema<CommentDoc>({
  threadId: { type: String, required: true, index: true },
  commentId: { type: String, required: true, unique: true },
  wallet: { type: String, required: true, index: true },
  message: { type: String, required: true },
  signature: { type: String, required: true },
  attachments: {
    type: [
      {
        attachmentId: { type: String, required: true },
        filename: { type: String, required: true },
        storageKey: { type: String, required: true },
        contentType: { type: String, required: true },
        size: { type: Number, required: true }
      }
    ],
    default: []
  },
  metadata: {
    ip: String,
    userAgent: String
  },
  flags: {
    spam: { type: Boolean, default: false },
    moderated: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false }
  },
  moderation: {
    deletedAt: Date,
    deletedBy: String,
    deletedReason: String,
    spamAt: Date,
    spamBy: String,
    spamReason: String
  }
}, { timestamps: true, versionKey: false });

CommentSchema.index({ threadId: 1, createdAt: -1 });
CommentSchema.index({ wallet: 1, createdAt: -1 });

export const CommentModel = model<CommentDoc>('Comment', CommentSchema);
