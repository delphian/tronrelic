/**
 * @file query-stream-registry.ts
 *
 * Tracks which in-flight streaming queries still have a listener, so core code
 * outside the provider call can push chunks into a running query's stream.
 *
 * The provider owns the answer text, but it is not the only part of core that
 * learns something worth showing mid-turn: the governor executes every tool
 * call, and that activity would otherwise stay invisible until the terminal
 * `done` chunk carries the finished transcript. The query controller holds the
 * only reference to the requesting socket, so this registry is the handoff —
 * the controller registers a query's sink for the life of the stream, and the
 * governor emits through it by `queryId` without knowing anything about sockets
 * or about which provider is installed.
 *
 * Registration is strictly scoped to one stream: an unknown or already-released
 * `queryId` emits nothing, so a late tool result from an abandoned query cannot
 * leak into another operator's transcript.
 *
 * This is a plain utility, not an `IXxxService` — the module constructs one and
 * injects it into the collaborators that need it, rather than publishing it on
 * the service registry.
 */

import type { IAiStreamChunk } from '@/types';

/** Destination for a streaming query's chunks, as the controller delivers them. */
export type QueryStreamSink = (chunk: IAiStreamChunk) => void;

/**
 * Registry of live streaming-query sinks, keyed by `queryId`.
 */
export class QueryStreamRegistry {
    /** Sinks for queries currently streaming; released the moment one settles. */
    private readonly sinks = new Map<string, QueryStreamSink>();

    /**
     * Open a query's stream to core-side emitters for the duration of the run.
     * Called by the query controller before it fires the provider, so anything
     * that happens during the query can still reach the operator watching it.
     *
     * Refuses to displace a run that is already streaming under this id. The id
     * is minted by the client, and this map is the one place two operators'
     * runs could meet: silently overwriting would route the first run's tool
     * arguments and results to the second operator's socket. A caller that is
     * told no should reject the request rather than proceed unregistered — an
     * id already in flight means the two runs would also collide in the
     * provider's own `queryId`-keyed cancel map.
     *
     * @param queryId - The client-generated id correlating this run's chunks.
     * @param sink - The controller's delivery closure for this run.
     * @returns True when the run now owns the id; false when another run holds it.
     */
    register(queryId: string, sink: QueryStreamSink): boolean {
        let registered = false;
        if (!this.sinks.has(queryId)) {
            this.sinks.set(queryId, sink);
            registered = true;
        }
        return registered;
    }

    /**
     * Close a query's stream to core-side emitters. Must be called when the run
     * settles however it settles — otherwise the map grows without bound and a
     * stale sink keeps pointing at a socket the operator left long ago.
     *
     * Releases only the caller's own registration: passing the sink back is what
     * stops a finishing run from tearing down a *different* run that reused the
     * id, which would leave that second operator's transcript silent for the
     * rest of its turn.
     *
     * @param queryId - The id supplied to {@link register}.
     * @param sink - The same sink that was registered; a mismatch is a no-op.
     */
    release(queryId: string, sink: QueryStreamSink): void {
        if (this.sinks.get(queryId) === sink) {
            this.sinks.delete(queryId);
        }
    }

    /**
     * Deliver a chunk to a running query's listener. A query that never streamed
     * (a programmatic or scheduled run), or one that has already settled, has no
     * sink and is silently skipped.
     *
     * Delivery is contained here rather than left to each caller: this file
     * invites core-side emitters whose real work has already happened by the
     * time they report it (the governor has run the tool), so a socket fault
     * must not surface as a failure of that work. The boolean is what a caller
     * inspects if it wants to know; nothing propagates.
     *
     * @param queryId - The run to deliver to.
     * @param chunk - The chunk to deliver.
     * @returns True when a live sink received the chunk without throwing.
     */
    emit(queryId: string, chunk: IAiStreamChunk): boolean {
        const sink = this.sinks.get(queryId);
        let delivered = false;
        if (sink) {
            try {
                sink(chunk);
                delivered = true;
            } catch {
                /* a dead socket must never fail the work being reported */
            }
        }
        return delivered;
    }
}
