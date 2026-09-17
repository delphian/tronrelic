/**
 * @fileoverview Owns one Address Origins climb: the Server-Sent Events
 * connection, the per-wallet ladders it fills in, and the terminal states.
 */

'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createAddressOriginsStream } from '../api/client';
import type { IOriginHop, IOriginLadder, OriginStopReason } from '../types';

/**
 * What a caller gets back from {@link useOriginTrace}.
 */
export interface IOriginTrace {
    /** Every trace in the current run, ordered by the input row that produced it. */
    ladders: IOriginLadder[];

    /** Whether a climb is open right now, for the submit button's busy state. */
    streaming: boolean;

    /**
     * Whether any wallet the caller submitted was left out of the trace. Worth
     * saying out loud, because otherwise a wallet simply never appears on screen
     * and nothing explains why.
     *
     * Deliberately not the `limited` flag the stream sends. That flag means "the
     * anonymous gate narrowed this plan", which the server sets for every
     * signed-out caller whether or not a wallet was actually dropped — reporting
     * it as trimming would accuse the tool of dropping a wallet on every
     * anonymous trace. This is derived from what came back against what went out,
     * which answers the narrower question for both tiers.
     */
    limited: boolean;

    /** A problem with the whole run, as opposed to one wallet's own failure. */
    error: string | null;

    /** Open a fresh climb over exactly these wallets, replacing any current run. */
    trace: (targets: string[]) => void;

    /** Report a problem the caller found before any request was worth sending. */
    reportProblem: (message: string) => void;
}

/**
 * Run an Address Origins climb and fold its event stream into ladders.
 *
 * Why this is a hook rather than state inside the page component: the stream has
 * a lifecycle of its own — it has to be torn down on unmount, on resubmission,
 * and on completion, and it reports three different failures through one
 * featureless `error` event. Keeping that machinery beside the page's layout
 * made it hard to see either clearly, and the teardown rules are exactly the
 * kind that break quietly when they are buried.
 *
 * @returns The current ladders plus the controls to start a run or flag a
 *          problem with one, as described by {@link IOriginTrace}.
 */
export function useOriginTrace(): IOriginTrace {
    const [laddersBySource, setLaddersBySource] = useState<Record<number, IOriginLadder>>({});
    const [streaming, setStreaming] = useState(false);
    const [limited, setLimited] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const sourceRef = useRef<EventSource | null>(null);
    const completedRef = useRef(false);
    // Whether the server accepted this trace and opened the stream. EventSource
    // surfaces every failure as the same bare `error` with no status attached, so
    // this flag is the only way to tell a refused request — a rate limit, most
    // often — from a stream that dropped mid-climb, and to word each honestly.
    const startedRef = useRef(false);

    /** Close any open stream. Idempotent; safe on unmount or on re-submit. */
    const stopStream = useCallback((): void => {
        sourceRef.current?.close();
        sourceRef.current = null;
    }, []);

    // Tear the stream down if the consumer unmounts mid-climb.
    useEffect(() => stopStream, [stopStream]);

    /**
     * Apply a change to one wallet's ladder, ignoring events for a row the
     * current run does not have. A stale event can only arrive from a stream
     * already closed, so dropping it is correct rather than merely safe.
     *
     * @param sourceIndex - Which input row the event belongs to.
     * @param change - How to rewrite that row's ladder.
     */
    const updateLadder = useCallback((sourceIndex: number, change: (ladder: IOriginLadder) => IOriginLadder): void => {
        setLaddersBySource(prev => {
            const ladder = prev[sourceIndex];
            return ladder ? { ...prev, [sourceIndex]: change(ladder) } : prev;
        });
    }, []);

    const trace = useCallback((targets: string[]): void => {
        stopStream();
        setError(null);
        setLaddersBySource({});
        setLimited(false);
        setStreaming(true);
        completedRef.current = false;
        startedRef.current = false;

        const stream = createAddressOriginsStream(targets);
        sourceRef.current = stream;

        /**
         * Parse one stream frame and hand it to its handler, ending the run if the
         * frame will not parse.
         *
         * Why every listener goes through this: an exception thrown inside an
         * `addEventListener` callback escapes to the window, so a truncated frame
         * would leave `streaming` stuck true with the progress indicator running
         * and no way for the reader to tell that anything had gone wrong. Failing
         * the run says so instead.
         *
         * @param event - The raw stream event carrying a JSON payload.
         * @param apply - What to do with the payload once it parses.
         */
        function readEvent<T>(event: Event, apply: (data: T) => void): void {
            let parsed: T | undefined;
            let ok = false;
            try {
                parsed = JSON.parse((event as MessageEvent).data) as T;
                ok = true;
            } catch {
                setError('The trace sent something this page could not read. Please retry.');
                stopStream();
                setStreaming(false);
            }
            // Applied outside the catch so a fault in the handler is not mistaken
            // for a malformed frame and reported to the reader as one.
            if (ok) {
                apply(parsed as T);
            }
        }

        stream.addEventListener('start', event => readEvent<{ addresses: string[] }>(event, data => {
            startedRef.current = true;
            // See the note on IOriginTrace.limited: the server's own flag answers
            // a different question, so this compares what came back against what
            // went out instead.
            setLimited(data.addresses.length < targets.length);
            const initial: Record<number, IOriginLadder> = {};
            data.addresses.forEach((address, index) => {
                initial[index] = { sourceIndex: index, address, hops: [], status: 'climbing' };
            });
            setLaddersBySource(initial);
        }));

        stream.addEventListener('hop', event => readEvent<IOriginHop>(event, hop => {
            updateLadder(hop.sourceIndex, ladder => ({ ...ladder, hops: [...ladder.hops, hop] }));
        }));

        stream.addEventListener('address-done', event => {
            readEvent<{ sourceIndex: number; stopReason: OriginStopReason }>(event, data => {
                updateLadder(data.sourceIndex, ladder => ({ ...ladder, status: 'done', stopReason: data.stopReason }));
            });
        });

        stream.addEventListener('address-error', event => {
            readEvent<{ sourceIndex: number; message: string }>(event, data => {
                updateLadder(data.sourceIndex, ladder => ({ ...ladder, status: 'error', errorMessage: data.message }));
            });
        });

        stream.addEventListener('complete', () => {
            completedRef.current = true;
            stopStream();
            setStreaming(false);
        });

        // EventSource fires 'error' for three different situations and describes
        // none of them: the normal end-of-stream close, a request the server
        // refused before opening the stream, and a connection that dropped
        // part-way through. completedRef rules out the first, and startedRef
        // separates the other two so the reader is not told their network failed
        // when they were actually rate limited.
        stream.onerror = () => {
            if (!completedRef.current) {
                setError(startedRef.current
                    ? 'The connection dropped while tracing. Please retry.'
                    : 'The trace could not be started. This tool allows a few traces per minute — wait a moment and retry.');
            }
            stopStream();
            setStreaming(false);
        };
    }, [stopStream, updateLadder]);

    const reportProblem = useCallback((message: string): void => {
        setError(message);
    }, []);

    const ladders = useMemo(
        () => Object.values(laddersBySource).sort((a, b) => a.sourceIndex - b.sourceIndex),
        [laddersBySource]
    );

    return { ladders, streaming, limited, error, trace, reportProblem };
}
