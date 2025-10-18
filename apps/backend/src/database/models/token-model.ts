import { Schema, model, type Document } from 'mongoose';

export type TokenType = 'trc10' | 'trc20' | 'sunpump' | 'contract';

/**
 * Plain field interface for Token documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export interface TokenFields {
  txId: string;
  contractAddress: string;
  ownerAddress: string;
  name: string;
  symbol: string;
  totalSupply?: number;
  decimals?: number;
  type: TokenType;
  createdAt: Date;
  updatedAt: Date;
  metadata?: Record<string, unknown>;
}

/**
 * Mongoose document interface for Token.
 * Extends both Document (for Mongoose methods) and TokenFields (for domain properties).
 */
export interface TokenDoc extends Document, TokenFields {}

const TokenSchema = new Schema<TokenDoc>(
  {
    txId: { type: String, required: true, unique: true, index: true },
    contractAddress: { type: String, required: true, index: true },
    ownerAddress: { type: String, required: true, index: true },
    name: { type: String, required: true },
    symbol: { type: String, required: true },
    totalSupply: { type: Number },
    decimals: { type: Number },
    type: { type: String, required: true, enum: ['trc10', 'trc20', 'sunpump', 'contract'] },
    metadata: { type: Schema.Types.Mixed }
  },
  { timestamps: true, versionKey: false }
);

TokenSchema.index({ contractAddress: 1, type: 1 });
TokenSchema.index({ ownerAddress: 1, type: 1 });

export const TokenModel = model<TokenDoc>('Token', TokenSchema);