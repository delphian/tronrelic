/**
 * @fileoverview Tests for the internal publish sink — the credential-free
 * `publish`-kind destination that exercises the curation destination pipeline.
 *
 * They prove the capability it advertises (so the picker offers it and the gate
 * admits it) and that delivering persists a durable record and emits the admin
 * signal, with and without a broadcast wired.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IContentDescriptor, ISystemLogService } from '@/types';
import {
    createInternalPublishSink,
    INTERNAL_PUBLISH_SINK_ID,
    CONTENT_PUBLISHED_EVENT,
    PUBLISHED_CONTENT_COLLECTION
} from '../internal-publish-sink.js';
import { createMockDatabaseService } from '../../tests/vitest/mocks/database-service.js';

/** No-op logger satisfying ISystemLogService. */
function silentLogger(): ISystemLogService {
    const noop = (): void => undefined;
    const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => logger } as unknown as ISystemLogService;
    return logger;
}

describe('internal publish sink', () => {
    it('advertises the publish capability the picker and gate rely on', () => {
        const sink = createInternalPublishSink(createMockDatabaseService(), silentLogger());

        expect(sink.id).toBe(INTERNAL_PUBLISH_SINK_ID);
        expect(sink.kind).toBe('publish');
        // Requires a body — under accepts ⊆ present it surfaces only for content
        // that carries one — and stays internal so any ceiling admits it.
        expect(sink.accepts).toEqual(['body']);
        expect(sink.reach).toEqual({ egress: 'internal', audience: 'admin' });
    });

    it('persists a published record and emits the publish signal on deliver', async () => {
        const database = createMockDatabaseService();
        const insertSpy = vi.spyOn(database, 'insertOne');
        const broadcast = vi.fn();
        const sink = createInternalPublishSink(database, silentLogger(), broadcast);
        const content: IContentDescriptor = { title: 'Mainnet upgrade', body: 'shipped' };

        await sink.deliver(content, { handle: '@tronrelic' });

        expect(insertSpy).toHaveBeenCalledOnce();
        const [collection, record] = insertSpy.mock.calls[0];
        expect(collection).toBe(PUBLISHED_CONTENT_COLLECTION);
        expect(record).toMatchObject({
            sinkId: INTERNAL_PUBLISH_SINK_ID,
            title: 'Mainnet upgrade',
            body: 'shipped',
            dest: { handle: '@tronrelic' }
        });
        expect(broadcast).toHaveBeenCalledWith(CONTENT_PUBLISHED_EVENT, expect.objectContaining({ title: 'Mainnet upgrade' }));
    });

    it('records the publish even when no broadcast sink is wired', async () => {
        const database = createMockDatabaseService();
        const insertSpy = vi.spyOn(database, 'insertOne');
        const sink = createInternalPublishSink(database, silentLogger());

        await sink.deliver({ body: 'no broadcast here' }, {});

        expect(insertSpy).toHaveBeenCalledOnce();
    });
});
