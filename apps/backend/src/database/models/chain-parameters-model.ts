import { Schema, model, type Document } from 'mongoose';
import type { IChainParameters } from '@tronrelic/types';

/**
 * MongoDB document type for chain parameters
 * Extends IChainParameters with Mongoose Document methods
 */
export interface IChainParametersDocument extends IChainParameters, Document {}

/**
 * Schema for storing TRON blockchain chain parameters
 * Updated every 10 minutes by ChainParametersFetcher
 */
const ChainParametersSchema = new Schema<IChainParametersDocument>(
    {
        network: {
            type: String,
            enum: ['mainnet', 'testnet'],
            required: true,
            index: true
        },
        parameters: {
            totalEnergyLimit: {
                type: Number,
                required: true
            },
            totalEnergyCurrentLimit: {
                type: Number,
                required: true
            },
            totalFrozenForEnergy: {
                type: Number,
                required: true
            },
            energyPerTrx: {
                type: Number,
                required: true
            },
            energyFee: {
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
        collection: 'chainParameters'
    }
);

// Index for efficient querying of latest parameters
ChainParametersSchema.index({ network: 1, fetchedAt: -1 });

export const ChainParametersModel = model<IChainParametersDocument>(
    'ChainParameters',
    ChainParametersSchema
);
