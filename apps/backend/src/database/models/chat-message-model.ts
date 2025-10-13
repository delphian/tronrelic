import { Schema, model, type Document } from 'mongoose';

export interface ChatMessageDoc extends Document {
  messageId: string;
  wallet: string;
  message: string;
  signature: string;
  createdAt: Date;
  updatedAt: Date;
  flags: {
    spam: boolean;
    deleted: boolean;
    moderated: boolean;
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

const ChatMessageSchema = new Schema<ChatMessageDoc>({
  messageId: { type: String, required: true, unique: true },
  wallet: { type: String, required: true, unique: true },
  message: { type: String, required: true },
  signature: { type: String, required: true },
  flags: {
    spam: { type: Boolean, default: false },
    deleted: { type: Boolean, default: false },
    moderated: { type: Boolean, default: false }
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

ChatMessageSchema.index({ createdAt: -1 });

export const ChatMessageModel = model<ChatMessageDoc>('ChatMessage', ChatMessageSchema);
