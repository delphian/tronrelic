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
 * Why a climb ended, mirroring the backend's `ActivationClimbStopReason`.
 *
 * Kept as a local copy rather than imported from the types package because this
 * is the SSE wire shape the tool page parses, not the service contract. The
 * distinction that matters to the UI: `'unresolved'` means the chain ran out of
 * *visibility*, which must never be worded as having reached an origin.
 */
export type OriginStopReason = 'unresolved' | 'depth-cap' | 'cycle' | 'provider-error';

/**
 * Client-side accumulation of one address's climb: the hops seen so far plus the
 * terminal state. `stopReason` is present once `status` is `done` and is what
 * the ladder's closing message is worded from; a status of `error` means the
 * stream itself failed before any terminal event arrived.
 */
export interface IOriginLadder {
    sourceIndex: number;
    address: string;
    hops: IOriginHop[];
    status: OriginLadderStatus;
    stopReason?: OriginStopReason;
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
