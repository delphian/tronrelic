/**
 * @fileoverview Type definitions for the tools frontend module.
 */

import type { ReactNode } from 'react';

/** Address conversion result from the API. */
export interface IAddressConversionResult {
    hex: string;
    base58check: string;
}

/** Energy estimation result from the API. */
export interface IEnergyEstimate {
    requiredEnergy: number;
    recommendedStake: number;
    estimatedCostTRX: number;
    averageEnergyPerCall: number;
    maxObservedEnergy: number;
    sampleSize: number;
    confidence: 'low' | 'medium' | 'high';
    energyPriceSun: number;
    estimatedRentPerDayTRX: number;
    estimatedRentPerMonthTRX: number;
    breakEvenDays: number | null;
    bandwidthFromStake: number;
    metadata: {
        energyPerTrx: number;
        bandwidthPerTrx: number;
        snapshotTimestamp: number;
    };
}

/** Bidirectional stake estimation result from the API. */
export interface IStakeEstimate {
    trx: number;
    energy: number;
    bandwidth: number;
    energyPerTrx: number;
    bandwidthPerTrx: number;
    snapshotTimestamp: number;
}

/** Signature verification result from the API. */
export interface ISignatureResult {
    verified: boolean;
    wallet: string;
}

/** Descriptor for a tool card on the landing page. */
export interface IToolDescriptor {
    title: string;
    description: string;
    href: string;
    icon: ReactNode;
}

/** Single token approval entry from the API. */
export interface IApprovalEntry {
    tokenAddress: string;
    tokenName: string;
    tokenSymbol: string;
    tokenDecimals: number;
    spenderAddress: string;
    allowance: string;
    allowanceFormatted: string;
    isUnlimited: boolean;
}

/** Approval check result from the API. */
export interface IApprovalCheckResult {
    ownerAddress: string;
    approvals: IApprovalEntry[];
    scannedAt: number;
    truncated: boolean;
}

/** Timestamp conversion result from the API. */
export interface ITimestampConversionResult {
    timestamp: number;
    timestampMs: number;
    dateString: string;
    blockNumber: number;
    blockNumberIsEstimate: boolean;
    relativeTime: string;
    referenceBlock: {
        number: number;
        timestamp: number;
    };
}
