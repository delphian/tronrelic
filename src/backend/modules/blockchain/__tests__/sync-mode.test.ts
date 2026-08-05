/**
 * Unit tests for the sync pacing decision. The dead band exists to stop the
 * syncer flapping between live-throttled and flat-out catch-up when lag sits on
 * a boundary, and flapping is exactly the kind of regression that hides behind
 * a plausible-looking refactor — so both edges and the hold-previous behavior
 * are pinned here.
 */
import { describe, it, expect } from 'vitest';
import { resolveCaughtUpMode } from '../sync-mode.js';

/** Production defaults: drop the throttle at 30 blocks behind, resume at 20. */
const THRESHOLDS = { resumeBlocks: 20, entryBlocks: 30 };

describe('resolveCaughtUpMode', () => {
    it('reports caught up when lag is at or below the resume threshold', () => {
        expect(resolveCaughtUpMode(0, false, THRESHOLDS)).toBe(true);
        expect(resolveCaughtUpMode(19, false, THRESHOLDS)).toBe(true);
        expect(resolveCaughtUpMode(20, false, THRESHOLDS)).toBe(true);
    });

    it('reports behind when lag is at or above the entry threshold', () => {
        expect(resolveCaughtUpMode(30, true, THRESHOLDS)).toBe(false);
        expect(resolveCaughtUpMode(31, true, THRESHOLDS)).toBe(false);
        expect(resolveCaughtUpMode(500, true, THRESHOLDS)).toBe(false);
    });

    it('holds the previous mode inside the dead band', () => {
        expect(resolveCaughtUpMode(21, true, THRESHOLDS)).toBe(true);
        expect(resolveCaughtUpMode(29, true, THRESHOLDS)).toBe(true);
        expect(resolveCaughtUpMode(21, false, THRESHOLDS)).toBe(false);
        expect(resolveCaughtUpMode(29, false, THRESHOLDS)).toBe(false);
    });

    it('does not flap as lag oscillates within the band', () => {
        // A throttled syncer drifting up to 29 and back stays throttled
        // throughout; only crossing 30 gives the throttle up.
        const drift = [20, 24, 29, 25, 29, 22];
        const modes = drift.reduce<boolean[]>((history, lag) => {
            const previous = history.length > 0 ? history[history.length - 1] : null;
            history.push(resolveCaughtUpMode(lag, previous, THRESHOLDS));
            return history;
        }, []);

        expect(modes.every(mode => mode === true)).toBe(true);
    });

    it('assumes behind when no previous mode is known inside the band', () => {
        // First tick after a restart, or after the scheduler lock moved to
        // another instance: catching up costs only speed, mistakenly throttling
        // a lagging syncer costs ground.
        expect(resolveCaughtUpMode(25, null, THRESHOLDS)).toBe(false);
    });

    it('still decides on a single boundary if the band is misconfigured', () => {
        const collapsed = { resumeBlocks: 30, entryBlocks: 30 };

        expect(resolveCaughtUpMode(29, null, collapsed)).toBe(true);
        expect(resolveCaughtUpMode(30, null, collapsed)).toBe(false);
    });
});
