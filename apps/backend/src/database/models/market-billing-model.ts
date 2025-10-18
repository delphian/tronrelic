import { Schema, model, type Document } from 'mongoose';

/**
 * Plain field interface for MarketBilling documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface MarketBillingFields {
  transactionId: string;
  transactionTimestamp: Date;
  addressFrom: string;
  addressTo: string;
  amountTRX: number;
  amountSun?: number;
  metadata?: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Mongoose document interface for MarketBilling.
 * Extends both Document (for Mongoose methods) and MarketBillingFields (for domain properties).
 */
export interface MarketBillingDoc extends Document, MarketBillingFields {}

const MarketBillingSchema = new Schema<MarketBillingDoc>(
  {
    transactionId: { type: String, required: true, unique: true, index: true },
    transactionTimestamp: { type: Date, required: true, index: true },
    addressFrom: { type: String, required: true, index: true },
    addressTo: { type: String, required: true, index: true },
    amountTRX: { type: Number, required: true },
    amountSun: { type: Number },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true, versionKey: false }
);

MarketBillingSchema.index({ addressTo: 1, transactionTimestamp: -1 });
MarketBillingSchema.index({ transactionTimestamp: -1, amountTRX: -1 });

export const MarketBillingModel = model<MarketBillingDoc>('MarketBilling', MarketBillingSchema);
