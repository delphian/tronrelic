/**
 * @fileoverview The internal publish sink — a credential-free `publish`-kind
 * content-router sink that exercises the destination-selection pipeline
 * end-to-end without any external integration.
 *
 * The content router's destination picker can only offer `publish` sinks, and no
 * external publish sink (a Twitter, a Telegram) ships yet. This sink fills that
 * gap: it is a real, selectable destination an operator can pick when approving a
 * held item, but it "publishes" by writing a durable record to a core collection
 * and emitting an admin WebSocket signal rather than calling out to a third
 * party. That keeps the whole picker → select → deliver → record arc testable and
 * demonstrable now, while a real external sink registers later through the
 * identical {@link IContentSink} contract with zero curation changes.
 *
 * Its `reach` is `{ internal, admin }` — publishing here never leaves the
 * platform and only admins see the log — so the classification gate admits it
 * under any content ceiling, including the restrictive default a curation type
 * carries when it declares none. Its `accepts` is `['body']`: there is nothing to
 * publish without body text, so under the router's `accepts ⊆ present` rule the
 * sink surfaces only for content that actually carries a body.
 *
 * @module backend/services/internal-publish-sink
 */

import { randomUUID } from 'node:crypto';
import type {
    IContentDescriptor,
    IContentSink,
    IDatabaseService,
    ISystemLogService
} from '@/types';

/** Sink id for the internal publish log, namespaced like a content type. */
export const INTERNAL_PUBLISH_SINK_ID = 'core:internal-publish';

/**
 * WebSocket event emitted when content is published to the internal log. Global
 * admin signal; the `/system` surfaces refetch on it. Needs a matching case in
 * {@link WebSocketService.emit}, whose switch drops events it does not name.
 */
export const CONTENT_PUBLISHED_EVENT = 'content:published';

/** Core collection the published records land in (no module prefix — core-owned). */
export const PUBLISHED_CONTENT_COLLECTION = 'published_content';

/**
 * Broadcast sink for the publish signal. Injected as a plain function — rather
 * than the WebSocket service — so the publish sink stays unit-testable and does
 * not reach for a singleton, the same decoupling the curation service's
 * broadcast takes. Optional; when absent, a publish records but emits nothing.
 */
type BroadcastFn = (event: string, payload: unknown) => void;

/**
 * Build the internal publish sink over the core database and an optional
 * broadcast. The dependencies are injected rather than reached through singletons
 * so the sink is unit-testable against mocks, matching the gate-sink and
 * notification-sink factories.
 *
 * @param database - Core database the published record is written to.
 * @param logger - Scoped logger for publish diagnostics.
 * @param broadcast - Optional sink for the `content:published` WebSocket signal.
 * @returns The content sink that publishes delivered content to the internal log.
 */
export function createInternalPublishSink(
    database: IDatabaseService,
    logger: ISystemLogService,
    broadcast?: BroadcastFn
): IContentSink {
    const sink: IContentSink = {
        id: INTERNAL_PUBLISH_SINK_ID,
        kind: 'publish',
        label: 'Internal publish log',
        accepts: ['body'],
        reach: { egress: 'internal', audience: 'admin' },

        /**
         * Publish the delivered descriptor to the internal log: persist a durable
         * record and emit the admin signal. Reads only the descriptor and the
         * admin-supplied destination config, never a content type id — the
         * narrow-waist contract every sink honours. The record freezes what was
         * published so the audit survives a later edit to the source.
         *
         * @param content - The rendered descriptor to publish.
         * @param dest - Admin-supplied destination config (unused here; the
         *   internal log needs none, but the contract carries it for sinks that do).
         * @returns Resolves once the record is written and the signal emitted.
         */
        async deliver(content: IContentDescriptor, dest: Record<string, unknown>): Promise<void> {
            const record = {
                id: randomUUID(),
                sinkId: INTERNAL_PUBLISH_SINK_ID,
                title: content.title,
                body: content.body,
                media: content.media,
                details: content.details,
                dest,
                publishedAt: new Date()
            };
            await database.insertOne(PUBLISHED_CONTENT_COLLECTION, record);
            logger.info({ id: record.id, title: content.title }, 'Content published to the internal log');
            broadcast?.(CONTENT_PUBLISHED_EVENT, {
                id: record.id,
                title: content.title,
                publishedAt: record.publishedAt.toISOString()
            });

            return;
        }
    };

    return sink;
}
