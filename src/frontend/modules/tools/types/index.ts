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

/**
 * One resolved activator step streamed from the Address Origins SSE endpoint.
 * `sourceIndex` ties the hop back to the input address that produced it so the
 * UI can grow several ladders in parallel and spot shared ancestors across them.
 */
export interface IOriginHop {
    sourceIndex: number;
    address: string;
    depth: number;
    activatorAddress: string;
    txId: string;
    blockTimestamp: number;
    contractType: string;
}

/** Lifecycle of a single address's climb in the UI. */
export type OriginLadderStatus = 'climbing' | 'done' | 'error';

/**
 * Client-side accumulation of one address's climb: the hops seen so far plus the
 * terminal state. `originReached` distinguishes a true root from a `truncated`
 * depth-cap stop; a status of `error` means the climb was interrupted.
 */
export interface IOriginLadder {
    sourceIndex: number;
    address: string;
    hops: IOriginHop[];
    status: OriginLadderStatus;
    originReached: boolean;
    truncated: boolean;
    errorMessage?: string;
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
