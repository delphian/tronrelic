/**
 * @fileoverview Judges the block pipeline healthy, degraded, or stalled.
 *
 * Admins reported that the old console made them assemble the answer to "is
 * ingestion healthy?" themselves from a dozen figures spread over two cards,
 * some of which contradicted each other. These rules make that judgement once,
 * on the backend, and return it with plain-English reasons, so the console's
 * banner and any script reading the endpoint agree.
 *
 * The thresholds are derived from the deployment's own configuration wherever
 * one exists — the buffer target, the backfill entry lag — so a deployment
 * tuned away from the defaults is judged against what it was told to do.
 *
 * A pure module: every input is passed in, including the clock, so the rules
 * are pinned by tests without a running pipeline.
 *
 * @module backend/modules/system/pipeline-health
 */
import type { IPipelineHealth, IPipelineHealthReason, IPipelineStatus, PipelineTone } from '@/types';

/** How recent an error or underrun must be to count against health. */
export const RECENT_WINDOW_MS = 10 * 60 * 1000;

/** A scheduler tick older than this means sync has stopped ticking. */
export const TICK_STALE_MS = 60 * 1000;

/** Receipt coverage below this, with receipts switched on, is degraded. */
export const RECEIPT_COVERAGE_WARNING_PERCENT = 99;

/** Blocks awaiting refetch above which the backfill queue is worth attention. */
export const BACKFILL_WARNING_SIZE = 20;

/** Fraction of an observer's queue in use at which it is falling behind. */
export const OBSERVER_QUEUE_WARNING_FRACTION = 0.5;

/**
 * Tone for ingestion lag: how many blocks old the newest fetched block is.
 *
 * Healthy ingestion keeps the newest fetched block within a sync tick of the
 * chain. Once it falls as far behind as the buffer's lead, the buffer can no
 * longer hide the gap and the feed will underrun, so that is the warning step.
 * At the backfill entry lag sync itself stops treating blocks as live work,
 * which is the danger step.
 *
 * @param lagBlocks - Age of the newest fetched block, in blocks, or null before any.
 * @param config - The deployment's buffer target and backfill entry lag.
 * @returns The tone the figure should carry.
 */
export function resolveIngestLagTone(lagBlocks: number | null, config: IPipelineStatus['config']): PipelineTone {
    let tone: PipelineTone = 'neutral';

    if (lagBlocks !== null) {
        const warning = Math.max(5, config.emitBufferTargetDepth);
        if (lagBlocks >= config.backfillEntryBlocks) {
            tone = 'danger';
        } else if (lagBlocks >= warning) {
            tone = 'warning';
        } else {
            tone = 'success';
        }
    }

    return tone;
}

/**
 * Tone for feed lag: how many blocks old the newest committed block is.
 *
 * The feed sits about a buffer's depth behind the chain by design, so the
 * target is the healthy value, not zero. Twice the target means the lead is
 * being spent faster than it refills; the backfill entry lag on top of the
 * target means the feed is as far behind as sync's own catch-up threshold.
 *
 * @param lagBlocks - Age of the newest committed block, in blocks, or null before any.
 * @param config - The deployment's buffer target and backfill entry lag.
 * @returns The tone the figure should carry.
 */
export function resolveFeedLagTone(lagBlocks: number | null, config: IPipelineStatus['config']): PipelineTone {
    let tone: PipelineTone = 'neutral';

    if (lagBlocks !== null) {
        const warning = Math.max(10, config.emitBufferTargetDepth * 2);
        const danger = Math.max(warning + 1, config.backfillEntryBlocks + config.emitBufferTargetDepth);
        if (lagBlocks >= danger) {
            tone = 'danger';
        } else if (lagBlocks >= warning) {
            tone = 'warning';
        } else {
            tone = 'success';
        }
    }

    return tone;
}

/**
 * Tone for receipt coverage.
 *
 * @param enabled - Whether receipts are switched on; coverage is not judged when off.
 * @param coveragePercent - Share of recent blocks with complete receipts, or null with none.
 * @returns The tone the figure should carry.
 */
export function resolveCoverageTone(enabled: boolean, coveragePercent: number | null): PipelineTone {
    let tone: PipelineTone = 'neutral';

    if (enabled && coveragePercent !== null) {
        tone = coveragePercent >= RECEIPT_COVERAGE_WARNING_PERCENT ? 'success' : 'warning';
    }

    return tone;
}

/**
 * Decide the pipeline's health and list the reasons.
 *
 * @param status - Every other part of the pipeline payload, already assembled.
 * @param now - Current time in milliseconds, passed in so tests can fix it.
 * @returns The overall level and its reasons, most severe first.
 */
export function resolvePipelineHealth(status: Omit<IPipelineStatus, 'health'>, now: number): IPipelineHealth {
    const reasons: IPipelineHealthReason[] = [];
    const { heights, sync, buffer, commit, receipts, backfill, errors, observers, config } = status;

    /**
     * Whether an ISO timestamp falls inside the recent window.
     *
     * @param at - The timestamp, or null.
     * @returns True when it is recent enough to count against health.
     */
    const isRecent = (at: string | null): boolean => at !== null && now - Date.parse(at) <= RECENT_WINDOW_MS;

    // Fetch: is sync running at all, and keeping up?
    if (!sync.job.registered || !sync.job.enabled) {
        reasons.push({
            level: 'danger',
            stage: 'fetch',
            message: sync.job.registered
                ? 'The blockchain:sync job is disabled, so no new blocks are being fetched.'
                : 'The blockchain:sync job is not registered; the scheduler may be switched off (ENABLE_SCHEDULER=false).'
        });
    } else if (sync.lastTickAt !== null && now - Date.parse(sync.lastTickAt) > TICK_STALE_MS) {
        const seconds = Math.round((now - Date.parse(sync.lastTickAt)) / 1000);
        reasons.push({ level: 'danger', stage: 'fetch', message: `The last sync tick finished ${seconds}s ago; sync is not ticking.` });
    }

    if (heights.fetched.lagTone === 'danger' || heights.fetched.lagTone === 'warning') {
        reasons.push({
            level: heights.fetched.lagTone,
            stage: 'fetch',
            message: `Ingestion is ${heights.fetched.lagBlocks} blocks behind the chain`
                + (heights.fetched.lagTone === 'danger'
                    ? `, past the ${config.backfillEntryBlocks}-block catch-up threshold.`
                    : `, more than the buffer's ${config.emitBufferTargetDepth}-block lead can cover.`)
        });
    }

    if (heights.head.fromCache) {
        reasons.push({ level: 'warning', stage: 'fetch', message: 'TronGrid did not answer the last chain-head request; sync scheduled against an older height.' });
    }

    const recentFetchErrors = errors.filter(error => (error.stage === 'fetch' || error.stage === 'schedule') && isRecent(error.at));
    if (recentFetchErrors.length > 0) {
        reasons.push({
            level: 'warning',
            stage: 'fetch',
            message: `${recentFetchErrors.length} fetch error${recentFetchErrors.length === 1 ? '' : 's'} in the last 10 minutes (latest: ${recentFetchErrors[0].errorClass}).`
        });
    }

    if (backfill.size > BACKFILL_WARNING_SIZE) {
        reasons.push({ level: 'warning', stage: 'fetch', message: `${backfill.size} blocks are waiting to be fetched again.` });
    }

    // Enrich: are receipts, and so decoded events, arriving?
    if (receipts.coverageTone === 'warning') {
        reasons.push({
            level: 'warning',
            stage: 'enrich',
            message: `Receipts are on but only ${receipts.coveragePercent}% of the last ${receipts.window} blocks got them all; those blocks carry no decoded events.`
        });
    }

    // Buffer: has the feed been exposed recently?
    if (isRecent(buffer.lastUnderrunAt)) {
        reasons.push({ level: 'warning', stage: 'buffer', message: 'The buffer ran out of lead in the last 10 minutes, so the live feed showed a gap.' });
    }

    if (buffer.depth >= config.emitBufferMaxDepth) {
        reasons.push({ level: 'warning', stage: 'buffer', message: `The buffer holds ${buffer.depth} blocks, at its ${config.emitBufferMaxDepth}-block maximum.` });
    }

    // Commit: are blocks being written?
    if (heights.committed.lagTone === 'danger' || heights.committed.lagTone === 'warning') {
        reasons.push({
            level: heights.committed.lagTone,
            stage: 'commit',
            message: `The newest committed block is ${heights.committed.lagBlocks} blocks old; the feed is designed to sit about ${config.emitBufferTargetDepth} behind.`
        });
    }

    if (commit.queued > Math.max(3, config.emitBufferTargetDepth)) {
        reasons.push({ level: 'danger', stage: 'commit', message: `${commit.queued} blocks are waiting to be written; writing is slower than the release clock.` });
    } else if (commit.queued > 3) {
        reasons.push({ level: 'warning', stage: 'commit', message: `${commit.queued} blocks are waiting to be written.` });
    }

    const recentCommitErrors = errors.filter(error => error.stage === 'commit' && isRecent(error.at));
    if (recentCommitErrors.length > 0) {
        reasons.push({
            level: 'danger',
            stage: 'commit',
            message: `${recentCommitErrors.length} commit${recentCommitErrors.length === 1 ? '' : 's'} failed in the last 10 minutes; those blocks reached no surface.`
        });
    }

    // Observers: is anyone falling behind?
    for (const observer of observers) {
        const capacity = observer.queueCapacity ?? 0;
        if (capacity > 0 && observer.queueDepth >= capacity * OBSERVER_QUEUE_WARNING_FRACTION) {
            reasons.push({
                level: 'warning',
                stage: 'observers',
                message: `Observer ${observer.name} has ${observer.queueDepth} of ${capacity} queue slots in use and will start dropping work when full.`
            });
        }
    }

    reasons.sort((left, right) => (left.level === right.level ? 0 : left.level === 'danger' ? -1 : 1));

    const stalled = reasons.some(reason => reason.level === 'danger' && reason.stage !== 'observers' && reason.stage !== 'enrich');
    const level: IPipelineHealth['level'] = stalled ? 'stalled' : reasons.length > 0 ? 'degraded' : 'healthy';

    return { level, reasons };
}
