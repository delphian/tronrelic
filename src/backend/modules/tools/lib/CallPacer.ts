/**
 * @fileoverview Minimum-interval pacer for a sequence of asynchronous steps.
 *
 * Some work is correct but should not run as fast as the machine can drive it.
 * The Address Origins climb is the case this exists for: each upward step costs
 * the shared TronGrid queue two or three calls, and a caller comparing ten
 * wallets can commission hundreds of steps from a single request. Core already
 * spaces the individual HTTP calls, but nothing spaced the *steps*, so one batch
 * drained the queue as fast as it would go.
 *
 * The pacer fixes that by giving each step a time slot of a fixed length. It is
 * deliberately ignorant of what the work is, so the rule can be tested against a
 * counter instead of against a blockchain.
 *
 * Two design choices are worth knowing before using it.
 *
 * First, the wait happens *after* the work rather than before it. Waiting first
 * spaces out when each step *starts*, but the caller still sees results arrive
 * unevenly, because a step that waited on a busy queue finishes late and the
 * next cheap step finishes almost immediately behind it. Waiting afterwards pads
 * every step out to the same total duration, so a consumer watching results
 * arrive gets one every `intervalMs` no matter how long any individual step
 * took. For a stream rendered live in a browser, that steadiness is the point.
 *
 * Second, calls are serialized through an internal promise chain. With one
 * caller stepping one thing at a time that chain never comes under contention,
 * but it is what makes the interval a property of the *pacer instance* rather
 * than of each separate caller. Share one instance and the steps share the
 * interval; hand out an instance each and they each get their own.
 */

/**
 * Options for one paced call.
 *
 * @template T - What the paced work resolves to, so `shouldPace` can inspect it.
 */
export interface ICallPacerRunOptions<T> {
    /**
     * Decides, once the work has finished, whether this call should be padded
     * out to the full interval. Defaults to padding every call.
     *
     * Why the decision is made after the work rather than before it: some steps
     * cannot be recognized as not worth pacing until they have run — a step that
     * turns out to report "the sequence is finished" is the example — and
     * padding those adds a full interval of dead time to the end of every run.
     *
     * @param result - What the work resolved to, so the caller can decide from
     *   the outcome rather than having to predict it.
     * @returns True to hold the result back until the slot is used up.
     */
    shouldPace?: (result: T) => boolean;
}

/**
 * Spaces a sequence of asynchronous steps to a minimum interval.
 */
export class CallPacer {
    /**
     * The promise every queued call chains onto, which is what serializes them.
     * It is kept settled-and-successful — failures are absorbed here, not hidden
     * from the caller — so one rejected step cannot wedge the queue behind it.
     */
    private tail: Promise<void> = Promise.resolve();

    /**
     * @param intervalMs - Minimum wall-clock time one paced call occupies,
     *   measured from the moment its work starts. A step that runs longer than
     *   this is never delayed further, so a slow provider is not punished twice.
     * @param signal - Optional cancellation, supplied when the work exists to
     *   serve something that can go away, such as an HTTP client that
     *   disconnects. On abort a call that is in its padding phase stops waiting
     *   and returns its result immediately rather than throwing, which leaves
     *   the question of what a cancelled run means with the caller that owns the
     *   signal instead of turning it into an error every caller has to filter.
     */
    public constructor(
        private readonly intervalMs: number,
        private readonly signal?: AbortSignal
    ) {}

    /**
     * Run one step, then hold its result back until the step's slot is used up.
     *
     * @param work - The step to run. It is invoked only once the calls already
     *   queued on this pacer have finished, so the caller does not have to
     *   sequence them itself.
     * @param options - Per-call pacing decision; see {@link ICallPacerRunOptions}.
     * @returns Whatever the work resolved to, once the slot has elapsed. A
     *   rejection propagates untouched and is never padded, because a failed
     *   step has no result worth holding back.
     */
    public run<T>(work: () => Promise<T>, options: ICallPacerRunOptions<T> = {}): Promise<T> {
        const turn = this.tail.then(() => this.execute(work, options));
        // Absorb the outcome for the queue's own bookkeeping only. The caller
        // still receives `turn` itself, so a rejection is reported exactly once.
        this.tail = turn.then(
            () => undefined,
            () => undefined
        );
        return turn;
    }

    /**
     * Time one step and pad it out, having already waited for its turn.
     *
     * @param work - The step to run.
     * @param options - Per-call pacing decision.
     * @returns The step's result, after any padding the options called for.
     */
    private async execute<T>(work: () => Promise<T>, options: ICallPacerRunOptions<T>): Promise<T> {
        const startedAt = Date.now();
        const result = await work();
        const shouldPace = options.shouldPace ? options.shouldPace(result) : true;
        if (shouldPace) {
            await this.sleep(this.intervalMs - (Date.now() - startedAt));
        }
        return result;
    }

    /**
     * Wait out the remainder of a slot, giving up early if the run was cancelled.
     *
     * Clearing the timer on abort matters beyond tidiness. A pending timer keeps
     * Node's event loop alive, so a process shutting down while several runs sat
     * mid-pad would otherwise wait for the last slot to expire before exiting.
     *
     * @param remainingMs - Time left in the slot. Zero or less returns at once,
     *   which is the normal case for a step that outran its own interval.
     * @returns Resolves when the slot is used up, or as soon as the signal aborts.
     */
    private sleep(remainingMs: number): Promise<void> {
        return new Promise<void>(resolve => {
            if (remainingMs <= 0 || this.signal?.aborted) {
                resolve();
                return;
            }

            /**
             * Settle once, from whichever of the two paths arrives first, leaving
             * behind neither a live timer nor a listener that could fire later.
             */
            const settle = (): void => {
                clearTimeout(timer);
                this.signal?.removeEventListener('abort', settle);
                resolve();
            };

            const timer = setTimeout(settle, remainingMs);
            this.signal?.addEventListener('abort', settle, { once: true });
        });
    }
}
