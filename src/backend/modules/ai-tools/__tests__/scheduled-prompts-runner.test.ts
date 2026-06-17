/**
 * @file scheduled-prompts-runner.test.ts
 *
 * Tests for runScheduledPrompts. Covers per-tick cron evaluation, the
 * provider-neutral execution path (`query({ mode: 'programmatic' })`), per-prompt
 * run-metadata write-back, error isolation between prompts, and the skip/fire
 * branch decisions that drive the scheduled-prompts feature.
 *
 * The runner consumes a SavedPromptsService and an active provider, so these
 * tests mock both interfaces directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScheduledPrompts, type IScheduledPromptRunner } from '../services/scheduled-prompts-runner.js';
import type { ISavedPrompt } from '@/types';

/* ---------- mock factories ---------- */

interface IRunResult {
    lastRunAt: string;
    lastRunError: string | null;
}

/**
 * Mock SavedPromptsService that tracks run-metadata writes and filters by
 * `scheduleEnabled` the same way the real service does.
 *
 * @param initialPrompts - Prompts the mock should surface from `listScheduled`.
 * @returns A mock with spies and exposed `_runResults` / `_failureCounts`.
 */
function createMockSavedPrompts(initialPrompts: ISavedPrompt[]) {
    const runResults = new Map<string, IRunResult>();
    const failureCounts = new Map<string, number>();
    return {
        listScheduled: vi.fn(async () => initialPrompts.filter(
            p => p.cron && p.cron.trim().length > 0 && p.scheduleEnabled !== false
        )),
        recordRunResult: vi.fn(async (id: string, lastRunAt: string, lastRunError: string | null) => {
            runResults.set(id, { lastRunAt, lastRunError });
        }),
        recordRunFailure: vi.fn(async (id: string, lastRunAt: string, errorMessage: string) => {
            runResults.set(id, { lastRunAt, lastRunError: errorMessage });
            failureCounts.set(id, (failureCounts.get(id) ?? 0) + 1);
            return { disabled: false };
        }),
        resetRunFailures: vi.fn(async (id: string) => {
            failureCounts.set(id, 0);
        }),
        _runResults: runResults,
        _failureCounts: failureCounts
    };
}

/** Minimal logger that swallows every level. */
function createMockLogger() {
    return {
        info: vi.fn(),
        debug: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        child: vi.fn().mockReturnThis()
    };
}

/** Mock active provider exposing the single `query` method the runner uses. */
function createMockProvider(): IScheduledPromptRunner & { query: ReturnType<typeof vi.fn> } {
    return { query: vi.fn().mockResolvedValue({ responseText: 'ok' }) };
}

/**
 * Build a saved prompt with sensible defaults and optional overrides.
 *
 * @param overrides - Fields to override on the default prompt.
 * @returns A saved prompt.
 */
function makePrompt(overrides: Partial<ISavedPrompt> = {}): ISavedPrompt {
    const now = new Date().toISOString();
    return {
        id: overrides.id ?? 'p1',
        name: overrides.name ?? 'Test Prompt',
        prompt: overrides.prompt ?? 'What is the current block height?',
        createdAt: overrides.createdAt ?? now,
        updatedAt: overrides.updatedAt ?? now,
        ...overrides
    };
}

/**
 * ISO timestamp for N minutes before now.
 *
 * @param n - Minutes in the past.
 * @returns The ISO timestamp.
 */
function minutesAgo(n: number): string {
    return new Date(Date.now() - n * 60_000).toISOString();
}

/* ---------- tests ---------- */

describe('runScheduledPrompts', () => {
    let logger: ReturnType<typeof createMockLogger>;
    let provider: ReturnType<typeof createMockProvider>;

    beforeEach(() => {
        logger = createMockLogger();
        provider = createMockProvider();
    });

    it('is a no-op when no scheduled prompts exist', async () => {
        const savedPrompts = createMockSavedPrompts([]);
        await runScheduledPrompts(savedPrompts as any, logger as any, provider);
        expect(provider.query).not.toHaveBeenCalled();
        expect(savedPrompts.recordRunResult).not.toHaveBeenCalled();
    });

    it('skips prompts with invalid cron strings and logs a warning', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'bad', cron: 'not-a-cron', lastRunAt: minutesAgo(10) })
        ]);
        await runScheduledPrompts(savedPrompts as any, logger as any, provider);
        expect(provider.query).not.toHaveBeenCalled();
        expect(savedPrompts.recordRunResult).not.toHaveBeenCalled();
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ promptId: 'bad', cron: 'not-a-cron' }),
            expect.stringContaining('invalid cron')
        );
    });

    it('fires a due prompt as an autonomous programmatic query', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({
                id: 'due',
                cron: '* * * * *',
                scheduleEnabled: true,
                lastRunAt: minutesAgo(5),
                prompt: 'run me'
            })
        ]);
        await runScheduledPrompts(savedPrompts as any, logger as any, provider);

        expect(provider.query).toHaveBeenCalledTimes(1);
        // Autonomous → programmatic mode, so the governor's external-tool
        // default-deny applies (triggerPath !== 'interactive').
        expect(provider.query).toHaveBeenCalledWith({ prompt: 'run me', mode: 'programmatic' });
        expect(savedPrompts.recordRunResult).toHaveBeenCalledTimes(1);
        const [id, , err] = savedPrompts.recordRunResult.mock.calls[0];
        expect(id).toBe('due');
        expect(err).toBeNull();
    });

    it('does not fire when the cron next-time is still in the future', async () => {
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'not-due', cron: '0 0 * * *', lastRunAt: tenSecondsAgo })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, provider);
        expect(provider.query).not.toHaveBeenCalled();
        expect(savedPrompts.recordRunResult).not.toHaveBeenCalled();
    });

    it('falls back to createdAt when lastRunAt is absent', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'first-run', cron: '* * * * *', createdAt: minutesAgo(10) })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, provider);
        expect(provider.query).toHaveBeenCalledTimes(1);
        expect(savedPrompts.recordRunResult).toHaveBeenCalledTimes(1);
    });

    it('anchors on scheduleAnchorAt over an older lastRunAt so a just-edited schedule does not fire retroactively', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({
                id: 'rescheduled',
                cron: '* * * * *',
                createdAt: minutesAgo(60),
                lastRunAt: minutesAgo(30),
                scheduleAnchorAt: new Date().toISOString()
            })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, provider);
        // The next every-minute occurrence after the just-now anchor is ~1 minute
        // out, so the prompt waits this tick rather than firing on the stale
        // lastRunAt / createdAt.
        expect(provider.query).not.toHaveBeenCalled();
        expect(savedPrompts.recordRunResult).not.toHaveBeenCalled();
    });

    it('captures lastRunError when the query throws', async () => {
        provider.query.mockRejectedValueOnce(new Error('Provider down'));
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'fails', cron: '* * * * *', lastRunAt: minutesAgo(5) })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, provider);

        expect(provider.query).toHaveBeenCalledTimes(1);
        // Claim-first: recordRunResult claims with a null error, then
        // recordRunFailure stamps the failure after query() rejected.
        expect(savedPrompts.recordRunResult).toHaveBeenCalledTimes(1);
        expect(savedPrompts.recordRunFailure).toHaveBeenCalledTimes(1);
        expect(logger.error).toHaveBeenCalled();

        const [, , claimErr] = savedPrompts.recordRunResult.mock.calls[0];
        expect(claimErr).toBeNull();
        const [, , err] = savedPrompts.recordRunFailure.mock.calls[0];
        expect(err).toBe('Provider down');
    });

    it('resets the failure streak after a successful run', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'ok', cron: '* * * * *', lastRunAt: minutesAgo(5) })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, provider);
        expect(savedPrompts.resetRunFailures).toHaveBeenCalledWith('ok');
    });

    it('logs when a failure trips the auto-pause', async () => {
        provider.query.mockRejectedValueOnce(new Error('still broken'));
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'broken', cron: '* * * * *', lastRunAt: minutesAgo(5) })
        ]);
        savedPrompts.recordRunFailure.mockResolvedValueOnce({ disabled: true });

        await runScheduledPrompts(savedPrompts as any, logger as any, provider);

        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ promptId: 'broken' }),
            expect.stringContaining('auto-paused')
        );
    });

    it('continues processing other prompts after one fails', async () => {
        provider.query
            .mockRejectedValueOnce(new Error('first failed'))
            .mockResolvedValueOnce({ responseText: 'ok' });

        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'first', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'a' }),
            makePrompt({ id: 'second', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'b' })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, provider);

        expect(provider.query).toHaveBeenCalledTimes(2);
        expect(savedPrompts.recordRunResult).toHaveBeenCalledTimes(2);
        expect(savedPrompts.recordRunFailure).toHaveBeenCalledTimes(1);
        expect(savedPrompts._runResults.get('first')!.lastRunError).toBe('first failed');
        expect(savedPrompts._runResults.get('second')!.lastRunError).toBeNull();
    });

    it('writes run metadata per-prompt rather than as a single batch', async () => {
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'due', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'run' }),
            makePrompt({ id: 'not-due', cron: '0 0 * * *', lastRunAt: tenSecondsAgo }),
            makePrompt({ id: 'bad', cron: 'not-a-cron', lastRunAt: minutesAgo(5) })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, provider);

        expect(provider.query).toHaveBeenCalledTimes(1);
        expect(provider.query).toHaveBeenCalledWith({ prompt: 'run', mode: 'programmatic' });
        // Only the fired prompt writes back — skipped/invalid ones don't churn the DB.
        expect(savedPrompts.recordRunResult).toHaveBeenCalledTimes(1);
        expect(savedPrompts.recordRunResult.mock.calls[0][0]).toBe('due');
    });
});
