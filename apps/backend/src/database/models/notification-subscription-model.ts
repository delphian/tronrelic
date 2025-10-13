import { Schema, model, type Document } from 'mongoose';
import type { NotificationChannel } from '@tronrelic/shared';

export interface NotificationSubscriptionDoc extends Document {
  wallet: string;
  channels: NotificationChannel[];
  thresholds: Record<string, number>;
  preferences: Record<string, unknown>;
  throttleOverrides?: Partial<Record<NotificationChannel, number>>;
}

const NotificationSubscriptionSchema = new Schema<NotificationSubscriptionDoc>({
  wallet: { type: String, required: true, unique: true },
  channels: { type: [String], default: ['websocket'] },
  thresholds: { type: Schema.Types.Mixed, default: {} },
  preferences: { type: Schema.Types.Mixed, default: {} },
  throttleOverrides: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true, versionKey: false });

NotificationSubscriptionSchema.index({ wallet: 1 });

export const NotificationSubscriptionModel = model<NotificationSubscriptionDoc>('NotificationSubscription', NotificationSubscriptionSchema);
