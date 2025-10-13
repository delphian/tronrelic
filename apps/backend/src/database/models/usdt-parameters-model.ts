import { Schema, model, type Document } from 'mongoose';
import type { IUsdtParameters } from '@tronrelic/types';

/**
 * MongoDB document type for USDT parameters
 * Extends IUsdtParameters with Mongoose Document methods
 */
export interface IUsdtParametersDocument extends IUsdtParameters, Document {}

/**
 * Schema for storing USDT TRC20 transaction parameters
 * Updated every 10 minutes by UsdtParametersFetcher
 *
 * Why this exists:
 * The energy cost for USDT transfers can vary based on contract implementation
 * and network state. Rather than hardcoding 65,000 energy, we query the actual
 * cost from the blockchain and cache it for use by market fetchers and calculators.
 */
const UsdtParametersSchema = new Schema<IUsdtParametersDocument>(
    {
        network: {
            type: String,
            enum: ['mainnet', 'testnet'],
            required: true,
            index: true
        },
        contractAddress: {
            type: String,
            required: true
        },
        parameters: {
            standardTransferEnergy: {
                type: Number,
                required: true
            },
            firstTimeTransferEnergy: {
                type: Number,
                required: true
            }
        },
        fetchedAt: {
            type: Date,
            required: true,
            index: true
        }
    },
    {
        timestamps: { createdAt: true, updatedAt: false },
        collection: 'usdtParameters'
    }
);

// Index for efficient querying of latest parameters
UsdtParametersSchema.index({ network: 1, fetchedAt: -1 });

export const UsdtParametersModel = model<IUsdtParametersDocument>(
    'UsdtParameters',
    UsdtParametersSchema
);
