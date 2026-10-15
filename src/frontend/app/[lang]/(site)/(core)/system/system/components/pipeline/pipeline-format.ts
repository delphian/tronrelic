/**
 * @fileoverview Labels and formatting shared by the Pipeline tab's panels.
 *
 * Every panel on the tab shows durations, block counts, and tones, and the
 * old console formatted each of them differently in different cells. Keeping
 * the formatting here gives one spelling for each figure. Numbers are
 * formatted with a fixed locale because the tab renders on the server first,
 * and a server locale that differed from the browser's would change the text
 * between the two renders and break hydration.
 */
import type { PipelineReceiptOutcome, PipelineReleaseMode, PipelineTone } from '@/types';

/** Locale used for every number on the tab, so server and browser render the same text. */
const NUMBER_LOCALE = 'en-US';

/** Tones a `<Badge>` accepts. */
export type BadgeTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * Format a whole number with thousands separators.
 *
 * @param value - The number, or null when unknown.
 * @returns The formatted number, or an em dash when unknown.
 */
export function formatNumber(value: number | null | undefined): string {
    return typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString(NUMBER_LOCALE) : '—';
}

/**
 * Format a duration in milliseconds at a precision that suits its size.
 *
 * @param ms - The duration, or null when unknown.
 * @returns For example `4.2 ms`, `180 ms`, or `1.25 s`.
 */
export function formatMs(ms: number | null | undefined): string {
    let text = '—';

    if (typeof ms === 'number' && Number.isFinite(ms)) {
        if (ms >= 1000) {
            text = `${(ms / 1000).toFixed(2)} s`;
        } else if (ms < 10) {
            text = `${ms.toFixed(1)} ms`;
        } else {
            text = `${Math.round(ms)} ms`;
        }
    }

    return text;
}

/**
 * Describe a gap in blocks and in the time it represents.
 *
 * Operators think in seconds of delay while the pipeline counts blocks, so
 * both are shown together.
 *
 * @param blocks - Number of blocks, or null when unknown.
 * @param blockIntervalSeconds - Seconds per block, from the payload.
 * @returns For example `20 blocks (~60 s)`.
 */
export function formatBlockGap(blocks: number | null | undefined, blockIntervalSeconds: number): string {
    let text = '—';

    if (typeof blocks === 'number' && Number.isFinite(blocks)) {
        const noun = blocks === 1 ? 'block' : 'blocks';
        text = `${formatNumber(blocks)} ${noun} (~${formatNumber(Math.round(blocks * blockIntervalSeconds))} s)`;
    }

    return text;
}

/**
 * Map a backend tone to a `<Badge>` tone.
 *
 * The two vocabularies overlap except that a badge also has `'info'`, so
 * every backend tone is already a valid badge tone. The function exists so a
 * change to either vocabulary is caught by the compiler here rather than at
 * every call site.
 *
 * @param tone - The tone the backend attached to a figure.
 * @returns The badge tone.
 */
export function toBadgeTone(tone: PipelineTone): BadgeTone {
    return tone;
}

/** Plain-English names for the stage keys recorded in block timings. */
export const STAGE_LABELS: Record<string, string> = {
    fetchBlock: 'Fetch block',
    getTrxPrice: 'TRX price',
    fetchReceipts: 'Fetch receipts',
    processTransactions: 'Parse and decode',
    calculateStats: 'Block totals',
    prepare: 'Prepare total',
    bulkWriteTransactions: 'Write transactions',
    updateBlockModel: 'Write block',
    updateSyncState: 'Advance cursor',
    commit: 'Commit total'
};

/** Short labels, tones, and explanations for each receipt outcome. */
export const RECEIPT_OUTCOME_DISPLAY: Record<PipelineReceiptOutcome, { label: string; tone: BadgeTone; hint: string }> = {
    complete: { label: 'Complete', tone: 'success', hint: 'A receipt came back for every transaction' },
    empty: { label: 'Empty block', tone: 'neutral', hint: 'The block had no transactions' },
    partial: { label: 'Partial', tone: 'warning', hint: 'Some receipts were missing, so the block carries no decoded events' },
    failed: { label: 'Failed', tone: 'danger', hint: 'Receipts were on but none came back' },
    disabled: { label: 'Off', tone: 'neutral', hint: 'Receipts were switched off for this block' }
};

/** What each buffer release mode means, for the Buffer stage card. */
export const RELEASE_MODE_DISPLAY: Record<PipelineReleaseMode, { label: string; tone: BadgeTone; hint: string }> = {
    seeding: { label: 'Seeding', tone: 'info', hint: 'Building its initial lead after a restart' },
    idle: { label: 'Idle', tone: 'neutral', hint: 'Nothing released yet' },
    refill: { label: 'Refilling', tone: 'info', hint: 'Below target, releasing slower than the chain to rebuild the lead' },
    steady: { label: 'Steady', tone: 'success', hint: 'At target, releasing at the chain\'s cadence' },
    drain: { label: 'Draining', tone: 'info', hint: 'Just above target, releasing slightly faster to give the surplus back' },
    'catch-up': { label: 'Catching up', tone: 'warning', hint: 'Well above target after a burst, releasing fast' },
    burst: { label: 'Bursting', tone: 'warning', hint: 'Past the maximum depth, releasing with no wait' }
};
