/**
 * @file scheduled-prompts-runner.test.ts
 *
 * Tests for runScheduledPrompts. Covers per-tick cron evaluation, the
 * provider-neutral execution path (`query({ mode: 'programmatic' })`), per-prompt
 * run-metadata write-back, error isolation between prompts, and the skip/fire
 * branch decisions that drive the scheduled-prompts feature.
 *
 * The runner consumes a SavedPromptsService and a provider resolver (mapping a
 * prompt's optional providerId to an executable provider), so these tests mock
 * both directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { runScheduledPrompts, type IScheduledPromptRunner } from '../services/scheduled-prompts-runner.js';
import type { IAiQueryRecord, ISavedPrompt } from '@/types';

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
        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);
        expect(provider.query).not.toHaveBeenCalled();
        expect(savedPrompts.recordRunResult).not.toHaveBeenCalled();
    });

    it('skips prompts with invalid cron strings and logs a warning', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'bad', cron: 'not-a-cron', lastRunAt: minutesAgo(10) })
        ]);
        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);
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
        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);

        expect(provider.query).toHaveBeenCalledTimes(1);
        // Autonomous → programmatic mode, so the governor's external-tool
        // default-deny applies (triggerPath !== 'interactive').
        expect(provider.query).toHaveBeenCalledWith({ prompt: 'run me', mode: 'programmatic' });
        expect(savedPrompts.recordRunResult).toHaveBeenCalledTimes(1);
        const [id, , err] = savedPrompts.recordRunResult.mock.calls[0];
        expect(id).toBe('due');
        expect(err).toBeNull();
    });

    it('forwards the composed system prompt as injectedSystemPrompt', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({
                id: 'due',
                cron: '* * * * *',
                scheduleEnabled: true,
                lastRunAt: minutesAgo(5),
                prompt: 'run me'
            })
        ]);
        // No owner on the prompt → composed against a null principal (master-only).
        const composeSystemPrompt = vi.fn(async () => 'INJECTED');

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider, undefined, composeSystemPrompt);

        expect(composeSystemPrompt).toHaveBeenCalledTimes(1);
        expect(provider.query).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: 'run me', mode: 'programmatic', injectedSystemPrompt: 'INJECTED' })
        );
    });

    it('forwards the prompt\'s toolAllowlist to the provider query', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({
                id: 'scoped',
                cron: '* * * * *',
                lastRunAt: minutesAgo(5),
                prompt: 'run me',
                toolAllowlist: ['tool-a', 'tool-b']
            })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);

        // The least-privilege selector rides the programmatic query so the
        // governor enforces it (undefined would mean "all enabled tools").
        expect(provider.query).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: 'run me', mode: 'programmatic', toolAllowlist: ['tool-a', 'tool-b'] })
        );
    });

    it('forwards an empty toolAllowlist ([] = no tools) rather than omitting it', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'toolless', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'run', toolAllowlist: [] })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);

        expect(provider.query).toHaveBeenCalledWith(
            expect.objectContaining({ prompt: 'run', toolAllowlist: [] })
        );
    });

    it('records the provider\'s precise unregistered-tool error verbatim as the failure reason', async () => {
        // The provider fails the run before the model call when the allowlist
        // names a tool that resolves to nothing (a disabled/renamed plugin). The
        // runner must forward that precise message into recordRunFailure so it
        // lands in lastRunError and counts toward auto-pause — not a generic error.
        const preciseError = 'unregistered tool(s): "gone"';
        provider.query.mockRejectedValueOnce(new Error(preciseError));
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'bad-tool', cron: '* * * * *', lastRunAt: minutesAgo(5), toolAllowlist: ['gone'] })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);

        expect(savedPrompts.recordRunFailure).toHaveBeenCalledTimes(1);
        const [, , reason] = savedPrompts.recordRunFailure.mock.calls[0];
        expect(reason).toBe(preciseError);
    });

    it('does not fire when the cron next-time is still in the future', async () => {
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'not-due', cron: '0 0 * * *', lastRunAt: tenSecondsAgo })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);
        expect(provider.query).not.toHaveBeenCalled();
        expect(savedPrompts.recordRunResult).not.toHaveBeenCalled();
    });

    it('falls back to createdAt when lastRunAt is absent', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'first-run', cron: '* * * * *', createdAt: minutesAgo(10) })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);
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

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);
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

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);

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

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);
        expect(savedPrompts.resetRunFailures).toHaveBeenCalledWith('ok');
    });

    it('logs when a failure trips the auto-pause', async () => {
        provider.query.mockRejectedValueOnce(new Error('still broken'));
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'broken', cron: '* * * * *', lastRunAt: minutesAgo(5) })
        ]);
        savedPrompts.recordRunFailure.mockResolvedValueOnce({ disabled: true });

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);

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

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);

        expect(provider.query).toHaveBeenCalledTimes(2);
        expect(savedPrompts.recordRunResult).toHaveBeenCalledTimes(2);
        expect(savedPrompts.recordRunFailure).toHaveBeenCalledTimes(1);
        expect(savedPrompts._runResults.get('first')!.lastRunError).toBe('first failed');
        expect(savedPrompts._runResults.get('second')!.lastRunError).toBeNull();
    });

    it('routes a pinned prompt to its provider and forwards the model override', async () => {
        const pinned = createMockProvider();
        const active = createMockProvider();
        const savedPrompts = createMockSavedPrompts([
            makePrompt({
                id: 'pinned',
                cron: '* * * * *',
                lastRunAt: minutesAgo(5),
                prompt: 'run me',
                providerId: 'other-provider',
                model: 'some-model'
            })
        ]);

        // Resolver returns the pinned provider for its id, the active one otherwise.
        await runScheduledPrompts(
            savedPrompts as any,
            logger as any,
            (providerId) => (providerId === 'other-provider' ? pinned : active)
        );

        expect(active.query).not.toHaveBeenCalled();
        expect(pinned.query).toHaveBeenCalledWith({ prompt: 'run me', model: 'some-model', mode: 'programmatic' });
    });

    it('records a failed run when a pinned provider is not installed', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({
                id: 'orphan',
                cron: '* * * * *',
                lastRunAt: minutesAgo(5),
                providerId: 'missing-provider'
            })
        ]);

        // Resolver returns null → provider not available.
        await runScheduledPrompts(savedPrompts as any, logger as any, () => null);

        // The run is claimed, then recorded as failed with a descriptive reason.
        expect(savedPrompts.recordRunResult).toHaveBeenCalledTimes(1);
        expect(savedPrompts.recordRunFailure).toHaveBeenCalledTimes(1);
        const [, , reason] = savedPrompts.recordRunFailure.mock.calls[0];
        expect(reason).toContain('missing-provider');
    });

    it('writes run metadata per-prompt rather than as a single batch', async () => {
        const tenSecondsAgo = new Date(Date.now() - 10_000).toISOString();
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'due', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'run' }),
            makePrompt({ id: 'not-due', cron: '0 0 * * *', lastRunAt: tenSecondsAgo }),
            makePrompt({ id: 'bad', cron: 'not-a-cron', lastRunAt: minutesAgo(5) })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);

        expect(provider.query).toHaveBeenCalledTimes(1);
        expect(provider.query).toHaveBeenCalledWith({ prompt: 'run', mode: 'programmatic' });
        // Only the fired prompt writes back — skipped/invalid ones don't churn the DB.
        expect(savedPrompts.recordRunResult).toHaveBeenCalledTimes(1);
        expect(savedPrompts.recordRunResult.mock.calls[0][0]).toBe('due');
    });

    it('re-resolves a prompt owner at fire time and forwards it as the endUser principal', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'owned', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'run', ownerUserId: 'u1' })
        ]);
        const resolveEndUser = vi.fn(async (userId: string) => ({ userId, groups: ['admin'], email: 'a@b.co' }));

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider, resolveEndUser);

        expect(resolveEndUser).toHaveBeenCalledWith('u1');
        // The run executes on the owner's behalf — endUser carries the live
        // principal so a user-owned-object tool scopes to that owner.
        expect(provider.query).toHaveBeenCalledWith({
            prompt: 'run',
            mode: 'programmatic',
            endUser: { userId: 'u1', groups: ['admin'], email: 'a@b.co' }
        });
        expect(savedPrompts.recordRunFailure).not.toHaveBeenCalled();
    });

    it('fails closed when an owned prompt\'s owner cannot be resolved', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'orphan-owner', cron: '* * * * *', lastRunAt: minutesAgo(5), ownerUserId: 'gone' })
        ]);
        // Deleted / unresolvable owner.
        const resolveEndUser = vi.fn(async () => null);

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider, resolveEndUser);

        // Never executes under no/stale authority; records the failed run instead.
        expect(provider.query).not.toHaveBeenCalled();
        expect(savedPrompts.recordRunFailure).toHaveBeenCalledTimes(1);
        const [, , reason] = savedPrompts.recordRunFailure.mock.calls[0];
        expect(reason).toContain('gone');
    });

    it('fails closed (and never escapes the loop) when the owner resolver throws', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'thrower', cron: '* * * * *', lastRunAt: minutesAgo(5), ownerUserId: 'u1' }),
            makePrompt({ id: 'after', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'run' })
        ]);
        // Transient identity/DB failure surfaces as a rejection, not a null.
        const resolveEndUser = vi.fn(async () => { throw new Error('identity service unavailable'); });

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider, resolveEndUser);

        // The throwing prompt is recorded as a failed run, treated exactly like a
        // null principal — never executed under no/stale authority.
        expect(savedPrompts.recordRunFailure).toHaveBeenCalledTimes(1);
        expect(savedPrompts.recordRunFailure.mock.calls[0][0]).toBe('thrower');
        // The exception did not abort the tick: the next due prompt still ran.
        expect(provider.query).toHaveBeenCalledTimes(1);
        expect(provider.query).toHaveBeenCalledWith({ prompt: 'run', mode: 'programmatic' });
    });

    it('fails closed for an owned prompt when no resolver is supplied', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'owned-no-resolver', cron: '* * * * *', lastRunAt: minutesAgo(5), ownerUserId: 'u1' })
        ]);

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider);

        expect(provider.query).not.toHaveBeenCalled();
        expect(savedPrompts.recordRunFailure).toHaveBeenCalledTimes(1);
    });

    it('runs an unowned prompt with no principal and never consults the resolver', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'unowned', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'run' })
        ]);
        const resolveEndUser = vi.fn(async () => ({ userId: 'x', groups: [] }));

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider, resolveEndUser);

        expect(resolveEndUser).not.toHaveBeenCalled();
        // No ownerUserId → endUser stays undefined (omitted by the matcher).
        expect(provider.query).toHaveBeenCalledWith({ prompt: 'run', mode: 'programmatic' });
    });

    it('records a successful run in the query history tagged scheduled and visible (carries a conversationId)', async () => {
        provider.query.mockResolvedValueOnce({ responseText: 'the answer', model: 'claude-x', usage: { inputTokens: 3, outputTokens: 7 } });
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'logged', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'analyze' })
        ]);
        const recordQuery = vi.fn(async (_record: IAiQueryRecord) => {});

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider, undefined, undefined, undefined, recordQuery);

        expect(recordQuery).toHaveBeenCalledTimes(1);
        const record = recordQuery.mock.calls[0]?.[0];
        // Tagged scheduled so the Query tab can tell it from an interactive run,
        // and carries a conversationId so the grouped history view surfaces it
        // (records without one are skipped as hidden one-shots).
        expect(record).toMatchObject({
            mode: 'scheduled',
            prompt: 'analyze',
            responseText: 'the answer',
            model: 'claude-x',
            status: 'completed',
            errorMessage: null,
            conversationId: expect.any(String)
        });
    });

    it('records a failed run in the query history with the error and a null response', async () => {
        provider.query.mockRejectedValueOnce(new Error('Provider down'));
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'logged-fail', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'analyze', model: 'pinned-model' })
        ]);
        const recordQuery = vi.fn(async (_record: IAiQueryRecord) => {});

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider, undefined, undefined, undefined, recordQuery);

        expect(recordQuery).toHaveBeenCalledTimes(1);
        const record = recordQuery.mock.calls[0]?.[0];
        expect(record).toMatchObject({
            mode: 'scheduled',
            prompt: 'analyze',
            responseText: null,
            // Falls back to the prompt's pinned model when the failed query
            // yields no result to read the model from.
            model: 'pinned-model',
            status: 'failed',
            errorMessage: 'Provider down'
        });
    });

    it('does not let a history-recorder fault disturb the run or its failure bookkeeping', async () => {
        const savedPrompts = createMockSavedPrompts([
            makePrompt({ id: 'noisy', cron: '* * * * *', lastRunAt: minutesAgo(5), prompt: 'run' })
        ]);
        const recordQuery = vi.fn(async () => { throw new Error('history db down'); });

        await runScheduledPrompts(savedPrompts as any, logger as any, () => provider, undefined, undefined, undefined, recordQuery);

        // The query still ran and its success was committed; the recorder throw
        // was swallowed and logged, never surfaced to the run loop.
        expect(provider.query).toHaveBeenCalledTimes(1);
        expect(savedPrompts.resetRunFailures).toHaveBeenCalledWith('noisy');
        expect(logger.warn).toHaveBeenCalledWith(
            expect.objectContaining({ promptId: 'noisy' }),
            expect.stringContaining('query history')
        );
    });
});
