import { Schema, model, type Document } from 'mongoose';

export interface TelegramUserDoc extends Document {
  telegramId: number;
  username?: string;
  firstName?: string;
  lastName?: string;
  languageCode?: string;
  score: number;
  lastInteraction?: Date;
}

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
