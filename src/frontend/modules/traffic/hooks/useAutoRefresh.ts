/**
 * useAutoRefresh Hook
 *
 * A single shared "refresh clock" for the traffic admin dashboards. The
 * aggregate analytics panels fetch once on mount and otherwise sit frozen until
 * an operator changes a control, so an admin watching the page sees stale
 * numbers with no indication they are stale. This hook emits a monotonically
 * increasing signal on a fixed interval; consumers add that signal to their
 * fetch effect's dependencies to re-pull data in place — flash-free, keeping
 * the prior data visible while the refetch lands rather than blanking to a
 * loading state (the SSR + Live Updates intent applied to a client-gated admin
 * surface).
 *
 * To keep this off the ClickHouse query path when nobody is looking, the clock
 * pauses whenever the browser tab is hidden and fires one immediate refresh the
 * moment it becomes visible again — so a returning admin sees current data at
 * once rather than waiting out a full interval on stale numbers.
 */

'use client';

import { useEffect, useState } from 'react';

/**
 * Emit an incrementing refresh signal on an interval, paused while hidden.
 *
 * Consumers treat the returned number as an opaque "refetch now" trigger: pass
 * it into a fetch effect's dependency array so the effect re-runs each tick.
 * The value itself carries no meaning beyond "it changed" — it exists so React
 * can distinguish one tick from the next.
 *
 * The interval only runs while `document.visibilityState === 'visible'`, and
 * regaining visibility bumps the signal immediately, so a backgrounded tab
 * neither polls the backend nor leaves the operator on stale data when they
 * return.
 *
 * @param intervalMs - Milliseconds between ticks while the tab is visible. The
 *   caller owns the cadence so different surfaces (e.g. a fast live counter vs.
 *   slower dashboards) can pick their own rate; changing it restarts the clock.
 * @param enabled - Whether the clock runs. Defaults to true so existing callers
 *   are unaffected. Pass false to pause ticking entirely (e.g. while the host
 *   page shows a tab whose child does not consume the signal), sparing the page
 *   needless re-renders; the returned signal holds its last value until
 *   re-enabled.
 * @returns A counter that increments on every tick — feed it to fetch-effect
 *   dependency arrays to drive a periodic, in-place refresh.
 */
export function useAutoRefresh(intervalMs: number, enabled = true): number {
    const [signal, setSignal] = useState(0);

    useEffect(() => {
        // SSR guard: the hosting page is a client component, but keep the hook
        // safe to call in any render environment by no-oping without a document.
        // Also no-op when disabled so a paused clock issues no ticks or fetches.
        if (typeof document === 'undefined' || !enabled) {
            return;
        }

        let timer: ReturnType<typeof setInterval> | undefined;

        /**
         * Start the tick interval if it is not already running. Idempotent so a
         * visibility change that fires while already visible cannot stack timers.
         */
        const start = (): void => {
            if (timer === undefined) {
                timer = setInterval(() => setSignal(previous => previous + 1), intervalMs);
            }
        };

        /**
         * Stop the tick interval so a hidden tab issues no background fetches.
         */
        const stop = (): void => {
            if (timer !== undefined) {
                clearInterval(timer);
                timer = undefined;
            }
        };

        /**
         * React to tab visibility: pause while hidden, and on return fire one
         * immediate refresh before resuming the interval so the operator never
         * stares at data that went stale while the tab was backgrounded.
         */
        const handleVisibility = (): void => {
            if (document.visibilityState === 'visible') {
                setSignal(previous => previous + 1);
                start();
            } else {
                stop();
            }
        };

        if (document.visibilityState === 'visible') {
            start();
        }
        document.addEventListener('visibilitychange', handleVisibility);

        return () => {
            stop();
            document.removeEventListener('visibilitychange', handleVisibility);
        };
    }, [intervalMs, enabled]);

    return signal;
}
