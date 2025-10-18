import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for TelegramUser documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface TelegramUserFields {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  score: number;
  lastInteraction?: Date;
}

/**
 * Mongoose document interface for TelegramUser.
 * Extends both Document (for Mongoose methods) and TelegramUserFields (for domain properties).
 */
export interface TelegramUserDoc extends Document, TelegramUserFields {}

const TelegramUserSchema = new Schema<TelegramUserDoc>({
  telegramId: { type: Number, required: true, unique: true },
  username: String,
  firstName: String,
  lastName: String,
  languageCode: String,
  score: { type: Number, default: 0 },
  lastInteraction: Date
}, { timestamps: true, versionKey: false });

export const TelegramUserModel = model<TelegramUserDoc>('TelegramUser', TelegramUserSchema);
