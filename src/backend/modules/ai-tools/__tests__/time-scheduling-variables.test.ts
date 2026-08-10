/**
 * @file time-scheduling-variables.test.ts
 *
 * Covers the "Time & Scheduling" built-in prompt variables.
 *
 * The whole value of `run-window-24` is that it removes date arithmetic from the
 * model, so these tests pin the exact rendered shapes a prompt depends on. A
 * drifted format is a silent regression: the model consumes whatever it is given
 * without complaint, and the damage only shows up as a mis-filtered report. The
 * boundary cases below (month rollover, zero-padding, millisecond truncation)
 * are precisely the ones a model gets wrong when asked to compute the window
 * itself, which is why they are computed here instead.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { IPromptVariableDefinition, IPromptVariableRegistry } from '@/types';
import { registerTimeSchedulingVariables } from '../variables/time-scheduling.js';

/**
 * Capture registrations without standing up the real registry. These variables
 * take no dependencies, so a recording double is the entire fixture — using the
 * concrete `PromptVariableRegistry` would drag in a mock database for no gain.
 *
 * @returns The registry double and the map its registrations land in.
 */
function createRecordingRegistry(): {
    registry: IPromptVariableRegistry;
    registered: Map<string, IPromptVariableDefinition>;
} {
    const registered = new Map<string, IPromptVariableDefinition>();
    const registry = {
        registerVariable: (definition: IPromptVariableDefinition): void => {
            registered.set(definition.name, definition);
        }
    } as unknown as IPromptVariableRegistry;
    return { registry, registered };
}

/**
 * Register the variables against a frozen clock and resolve one by name.
 *
 * @param name - The variable to resolve.
 * @param nowIso - The instant to freeze the system clock at.
 * @returns The variable's resolved text.
 */
async function resolveAt(name: string, nowIso: string): Promise<string> {
    vi.setSystemTime(new Date(nowIso));
    const { registry, registered } = createRecordingRegistry();
    registerTimeSchedulingVariables(registry);
    const definition = registered.get(name);
    if (!definition) {
        throw new Error(`Variable "${name}" was not registered`);
    }
    const resolved = await definition.resolve();
    return resolved;
}

describe('Time & Scheduling prompt variables', () => {
    beforeEach(() => {
        vi.useFakeTimers();
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    describe('registration', () => {
        it('registers run-window-24 classified public', () => {
            const { registry, registered } = createRecordingRegistry();

            registerTimeSchedulingVariables(registry);

            const definition = registered.get('run-window-24');
            expect(definition).toBeDefined();
            expect(definition?.category).toBe('Time & Scheduling');
            // `public` keeps the variable out of the trifecta private-data leg —
            // a clock reveals nothing, and defaulting it to `internal` would
            // misreport every prompt that references it.
            expect(definition?.sensitivity).toBe('public');
        });
    });

    describe('run-window-24', () => {
        it('renders both bounds exactly 24 hours apart in citation format', async () => {
            const resolved = await resolveAt('run-window-24', '2026-08-09T11:52:25.123Z');

            expect(resolved).toContain('RUN_TIME:         Aug 9, 11:52 UTC');
            expect(resolved).toContain('WINDOW_START:     Aug 8, 11:52 UTC');
        });

        it('drops milliseconds from both ISO forms so they compare as plain text', async () => {
            const resolved = await resolveAt('run-window-24', '2026-08-09T11:52:25.123Z');

            expect(resolved).toContain('RUN_TIME_ISO:     2026-08-09T11:52:25Z');
            expect(resolved).toContain('WINDOW_START_ISO: 2026-08-08T11:52:25Z');
            expect(resolved).not.toContain('.123');
        });

        it('publishes an ISO twin for both bounds so a window can be closed at each end', async () => {
            // Without an upper-bound ISO a prompt can only string-compare one
            // end, leaving a future-dated source timestamp to pass the filter
            // or forcing the model to reformat the citation form by hand — the
            // arithmetic this variable exists to eliminate.
            const resolved = await resolveAt('run-window-24', '2026-08-09T11:52:25.000Z');

            const isoLines = resolved.split('\n').filter(line => line.includes('_ISO:'));
            expect(isoLines).toHaveLength(2);
            for (const line of isoLines) {
                expect(line).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
            }
        });

        it('crosses a month boundary correctly', async () => {
            const resolved = await resolveAt('run-window-24', '2026-09-01T00:30:00.000Z');

            expect(resolved).toContain('RUN_TIME:         Sep 1, 00:30 UTC');
            expect(resolved).toContain('RUN_TIME_ISO:     2026-09-01T00:30:00Z');
            expect(resolved).toContain('WINDOW_START:     Aug 31, 00:30 UTC');
            expect(resolved).toContain('WINDOW_START_ISO: 2026-08-31T00:30:00Z');
        });

        it('crosses a year boundary correctly', async () => {
            const resolved = await resolveAt('run-window-24', '2027-01-01T09:05:00.000Z');

            expect(resolved).toContain('RUN_TIME:         Jan 1, 09:05 UTC');
            expect(resolved).toContain('WINDOW_START:     Dec 31, 09:05 UTC');
            expect(resolved).toContain('WINDOW_START_ISO: 2026-12-31T09:05:00Z');
        });

        it('zero-pads single-digit hours and minutes', async () => {
            const resolved = await resolveAt('run-window-24', '2026-08-09T02:05:00.000Z');

            expect(resolved).toContain('RUN_TIME:         Aug 9, 02:05 UTC');
        });

        it('reports times in UTC regardless of the server timezone', async () => {
            // The container's zone is not the operator's, and a citation that
            // silently shifted with it would be wrong in a published post.
            const resolved = await resolveAt('run-window-24', '2026-08-09T23:30:00.000Z');

            expect(resolved).toContain('RUN_TIME:         Aug 9, 23:30 UTC');
            expect(resolved).toContain('WINDOW_START:     Aug 8, 23:30 UTC');
        });

        it('labels the window span so the prompt need not restate it', async () => {
            const resolved = await resolveAt('run-window-24', '2026-08-09T11:52:25.000Z');

            expect(resolved).toContain('Reporting window (trailing 24 hours):');
        });
    });
});
