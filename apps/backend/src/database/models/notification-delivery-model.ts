import { Schema, model, type Document } from 'mongoose';
import type { NotificationChannel } from '@tronrelic/shared';

/**
 * Plain field interface for NotificationDelivery documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface NotificationDeliveryFields {
  wallet: string;
  channel: NotificationChannel;
  event: string;
  payloadHash: string;
  lastSentAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose document interface for NotificationDelivery.
 * Extends both Document (for Mongoose methods) and NotificationDeliveryFields (for domain properties).
 */
export interface NotificationDeliveryDoc extends Document, NotificationDeliveryFields {}

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
