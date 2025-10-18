import { Schema, model, type Document } from 'mongoose';
import type { IChainParameters } from '@tronrelic/types';

/**
 * Plain field interface for ChainParameters documents.
 * Use this when working with `.lean()` queries to avoid type mismatches with Mongoose Document types.
 */
export type IChainParametersFields = IChainParameters;

/**
 * MongoDB document type for chain parameters
 * Extends both Document (for Mongoose methods) and IChainParameters (for domain properties)
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
