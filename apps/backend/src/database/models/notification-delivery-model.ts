import { Schema, model, type Document } from 'mongoose';
import type { NotificationChannel } from '@tronrelic/shared';

export interface NotificationDeliveryDoc extends Document {
  wallet: string;
  channel: NotificationChannel;
  event: string;
  payloadHash: string;
  lastSentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const NotificationDeliverySchema = new Schema<NotificationDeliveryDoc>(
  {
    wallet: { type: String, required: true },
    channel: { type: String, required: true },
    event: { type: String, required: true },
    payloadHash: { type: String, required: true },
    lastSentAt: { type: Date, required: true }
  },
  { timestamps: true, versionKey: false }
);

NotificationDeliverySchema.index({ wallet: 1, channel: 1, event: 1 }, { unique: true });
NotificationDeliverySchema.index({ lastSentAt: -1 });

export const NotificationDeliveryModel = model<NotificationDeliveryDoc>('NotificationDelivery', NotificationDeliverySchema);
