/**
 * @fileoverview Shared presentation for a wallet's account-history download
 * status.
 *
 * Why it exists: the wallet switcher chip, the demoted manage list, and the
 * still-syncing detail notice all need to describe the same backfill state, and
 * the copy must stay honest — TRON fingerprint paging never reveals a total, so
 * progress is expressed as absolute counts plus the oldest point reached, never
 * a fabricated percentage. Centralising the status → (tone, label, tooltip)
 * mapping keeps that honest wording in one audited place instead of drifting
 * across the three surfaces that render it.
 */

import type { IAccountIngestionProgress } from '@/types';

/** Badge tone vocabulary shared with the {@link Badge} component. */
export type WalletHistoryTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * The presentation for one wallet's history-download status: the badge tone, a
 * short label, and an explanatory tooltip sentence.
 */
export interface IWalletHistoryStatus {
    /** Badge/dot tone conveying the state at a glance. */
    tone: WalletHistoryTone;
    /** Short label for the badge. */
    label: string;
    /** One-sentence explanation for the tooltip. */
    tooltip: string;
    /** True once the full available history is downloaded — the detail view unlocks. */
    complete: boolean;
}

/**
 * Map one ingestion-progress record to its badge tone, label, and tooltip.
 *
 * Kept declarative and honest: the "running" and "complete" copy quote the
 * absolute record count the caller supplies rather than a percentage, because
 * the total is unknowable up front.
 *
 * @param progress - The wallet's ingestion progress record.
 * @returns The tone, label, tooltip, and completeness for this wallet.
 */
export function describeHistoryStatus(progress: IAccountIngestionProgress): IWalletHistoryStatus {
    const rows = progress.rowsIngested.toLocaleString();
    switch (progress.status) {
        case 'queued':
            return {
                tone: 'neutral',
                label: 'History queued',
                tooltip: 'This wallet is enrolled in the account-history program. Its full transaction history is scheduled to download and will begin shortly.',
                complete: false
            };
        case 'running':
            return {
                tone: 'info',
                label: 'Downloading history',
                tooltip: `Downloading this wallet's full transaction history — ${rows} records saved so far.`,
                complete: false
            };
        case 'complete':
            return {
                tone: 'success',
                label: 'History downloaded',
                tooltip: `This wallet's full available transaction history has been downloaded (${rows} records).`,
                complete: true
            };
        case 'paused':
            return {
                tone: 'neutral',
                label: 'History paused',
                tooltip: 'The history download for this wallet is paused. It will resume automatically.',
                complete: false
            };
        case 'failed':
            return {
                tone: 'danger',
                label: 'History error',
                tooltip: 'The history download for this wallet hit an error. It will retry automatically.',
                complete: false
            };
        default:
            return {
                tone: 'neutral',
                label: 'History',
                tooltip: 'Transaction history download status for this wallet.',
                complete: false
            };
    }
}
