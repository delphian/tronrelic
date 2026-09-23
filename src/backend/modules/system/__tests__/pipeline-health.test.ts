/**
 * Unit tests for the pipeline health rules.
 *
 * The Pipeline tab's banner states these results as the answer to "is
 * ingestion healthy?", so each rule is pinned: when it fires, how severe it
 * is, and which levels make the pipeline "stalled" rather than "degraded".
 */
import { describe, it, expect } from 'vitest';
import type { IPipelineStatus } from '@/types';
import {
    resolveCoverageTone,
    resolveFeedLagTone,
    resolveIngestLagTone,
    resolvePipelineHealth
} from '../pipeline-health.js';

/** Fixed clock for every test. */
const NOW = Date.parse('2026-09-23T12:00:00.000Z');

/** Default configuration, matching a stock deployment. */
const CONFIG: IPipelineStatus['config'] = {
    blockIntervalSeconds: 3,
    backfillEntryBlocks: 65,
    liveChainThrottleBlocks: 45,
    emitBufferTargetDepth: 20,
    emitBufferCatchupDepth: 33,
    emitBufferMaxDepth: 66
};

/**
 * Build a healthy pipeline payload, minus health, for a test to break.
 *
 * @returns The payload.
 */
function healthyStatus(): Omit<IPipelineStatus, 'health'> {
    return {
        generatedAt: new Date(NOW).toISOString(),
        config: CONFIG,
        heights: {
            head: { blockNumber: 1000, observedAt: new Date(NOW - 5000).toISOString(), fromCache: false },
            fetched: { blockNumber: 998, blockTimestamp: null, lagBlocks: 2, lagTone: 'success' },
            buffered: 20,
            committed: { blockNumber: 978, blockTimestamp: null, lagBlocks: 22, lagTone: 'success' },
            cursor: 978
        },
        sync: {
            mode: 'live',
            job: { registered: true, enabled: true, schedule: '*/15 * * * * *' },
            lastTickAt: new Date(NOW - 5000).toISOString(),
            lastBatchSize: 5,
            ingestBlocksPerMinute: 20,
            networkBlocksPerMinute: 20,
            standingError: null
        },
        buffer: {
            depth: 20,
            targetDepth: 20,
            seeded: true,
            releaseMode: 'steady',
            lastIntervalMs: 3000,
            underruns: 0,
            underrunBlocks: 0,
            lastUnderrunAt: null,
            flushes: 0
        },
        commit: { queued: 0, failures: 0, commitBlocksPerMinute: 20 },
        receipts: { enabled: true, window: 300, complete: 300, partial: 0, failed: 0, disabled: 0, empty: 0, coveragePercent: 100, coverageTone: 'success' },
        stages: [],
        backfill: { size: 0, oldest: null, newest: null, sample: [] },
        errors: [],
        recentBlocks: [],
        observers: []
    };
}

describe('lag and coverage tones', () => {
    it('warns on ingest lag once it exceeds the buffer lead, and fails at the catch-up threshold', () => {
        expect(resolveIngestLagTone(null, CONFIG)).toBe('neutral');
        expect(resolveIngestLagTone(5, CONFIG)).toBe('success');
        expect(resolveIngestLagTone(20, CONFIG)).toBe('warning');
        expect(resolveIngestLagTone(65, CONFIG)).toBe('danger');
    });

    it('treats a feed lag near the buffer target as healthy', () => {
        expect(resolveFeedLagTone(25, CONFIG)).toBe('success');
        expect(resolveFeedLagTone(40, CONFIG)).toBe('warning');
        expect(resolveFeedLagTone(85, CONFIG)).toBe('danger');
    });

    it('judges coverage only while receipts are switched on', () => {
        expect(resolveCoverageTone(false, 0)).toBe('neutral');
        expect(resolveCoverageTone(true, 99.5)).toBe('success');
        expect(resolveCoverageTone(true, 80)).toBe('warning');
    });
});

describe('resolvePipelineHealth', () => {
    it('reports a healthy pipeline with no reasons', () => {
        expect(resolvePipelineHealth(healthyStatus(), NOW)).toEqual({ level: 'healthy', reasons: [] });
    });

    it('calls the pipeline stalled when the sync job is disabled', () => {
        const status = healthyStatus();
        status.sync.job.enabled = false;

        const health = resolvePipelineHealth(status, NOW);
        expect(health.level).toBe('stalled');
        expect(health.reasons[0]).toMatchObject({ level: 'danger', stage: 'fetch' });
    });

    it('calls the pipeline stalled when sync has not ticked for over a minute', () => {
        const status = healthyStatus();
        status.sync.lastTickAt = new Date(NOW - 90_000).toISOString();

        expect(resolvePipelineHealth(status, NOW).level).toBe('stalled');
    });

    it('degrades on a recent underrun but ignores an old one', () => {
        const recent = healthyStatus();
        recent.buffer.lastUnderrunAt = new Date(NOW - 60_000).toISOString();
        expect(resolvePipelineHealth(recent, NOW)).toMatchObject({ level: 'degraded', reasons: [{ stage: 'buffer' }] });

        const old = healthyStatus();
        old.buffer.lastUnderrunAt = new Date(NOW - 60 * 60_000).toISOString();
        expect(resolvePipelineHealth(old, NOW).level).toBe('healthy');
    });

    it('degrades rather than stalls when only receipt coverage is low', () => {
        const status = healthyStatus();
        status.receipts.coveragePercent = 90;
        status.receipts.coverageTone = 'warning';

        expect(resolvePipelineHealth(status, NOW)).toMatchObject({ level: 'degraded', reasons: [{ stage: 'enrich' }] });
    });

    it('calls the pipeline stalled after a recent commit failure', () => {
        const status = healthyStatus();
        status.errors = [{ at: new Date(NOW - 1000).toISOString(), blockNumber: 979, stage: 'commit', errorClass: 'commit', message: 'write failed' }];

        expect(resolvePipelineHealth(status, NOW).level).toBe('stalled');
    });

    it('flags an observer whose queue is half full, without calling the pipeline stalled', () => {
        const status = healthyStatus();
        status.observers = [{
            name: 'WhaleObserver', queueDepth: 60, queueCapacity: 100, totalProcessed: 0, totalErrors: 0, totalDropped: 0,
            avgProcessingTimeMs: 0, minProcessingTimeMs: 0, maxProcessingTimeMs: 0, lastProcessedAt: null, lastErrorAt: null, errorRate: 0
        }];

        expect(resolvePipelineHealth(status, NOW)).toMatchObject({ level: 'degraded', reasons: [{ stage: 'observers' }] });
    });

    it('lists danger reasons before warnings', () => {
        const status = healthyStatus();
        status.heights.head.fromCache = true;
        status.commit.queued = 25;

        const levels = resolvePipelineHealth(status, NOW).reasons.map(reason => reason.level);
        expect(levels).toEqual(['danger', 'warning']);
    });
});
