/**
 * @file curation-module.test.ts
 *
 * Covers the curation module's two-phase lifecycle (init prepares, run mounts +
 * publishes), the CurationService held-item lifecycle (register / hold / decide /
 * edit, disabled-owner blocking, live-preview resolution), and the auto-approve
 * AsyncLocalStorage context's liveness scoping.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type {
    ContentDescriptorFeature,
    IContentClassification,
    IContentSink,
    ICurationItem,
    ICurationType,
    IMenuService,
    ISystemLogService
} from '@/types';
import { CurationModule } from '../CurationModule.js';
import { CurationService } from '../services/curation-service.js';
import { CurationQueue } from '../services/curation-queue.js';
import { CurationDestinationDefaults } from '../services/curation-destination-defaults.js';
import { runWithCurationAutoApprove, shouldAutoApproveCuration } from '../services/curation-auto-approve-context.js';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { createMockServiceRegistry } from '../../../tests/vitest/mocks/service-registry.js';
import { ContentRegistry, CONTENT_TYPES_SERVICE } from '../../../services/content-registry.js';
import { ContentRouter, CONTENT_ROUTER_SERVICE } from '../../../services/content-router.js';
import { ClassificationGate, AllowAllRoutingPolicy } from '../../../services/content-routing-gate.js';

/** Minimal logger that swallows every level and returns itself for `child()`. */
function createMockLogger(): ISystemLogService {
    const logger = {
        info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), trace: vi.fn(), fatal: vi.fn(),
        child: vi.fn(() => logger)
    };
    return logger as unknown as ISystemLogService;
}

/** Minimal menu service whose `create` records the admin nav registration. */
function createMockMenuService(): IMenuService {
    return { create: vi.fn(async () => ({ _id: 'menu-curation' })) } as unknown as IMenuService;
}

/** Build a curation type whose callbacks are spies, overridable per test. */
function spyCurationType(over: Partial<ICurationType> = {}): ICurationType {
    return {
        typeId: 'x-poster:tweet',
        label: 'Tweet',
        describe: vi.fn(async (ref: Record<string, unknown>) => ({ body: `draft ${String(ref.postId ?? '')}` })),
        onApprove: vi.fn(async () => undefined),
        onReject: vi.fn(async () => undefined),
        ...over
    };
}

describe('CurationModule', () => {
    let module: CurationModule;
    let mockApp: { use: ReturnType<typeof vi.fn> };
    let mockRegistry: ReturnType<typeof createMockServiceRegistry>;
    let mockMenu: IMenuService;
    let contentRouter: ContentRouter;

    beforeEach(async () => {
        module = new CurationModule();
        mockApp = { use: vi.fn() };
        contentRouter = new ContentRouter(new ClassificationGate(new AllowAllRoutingPolicy()), createMockLogger());
        mockRegistry = createMockServiceRegistry({
            [CONTENT_TYPES_SERVICE]: new ContentRegistry(createMockLogger()),
            [CONTENT_ROUTER_SERVICE]: contentRouter
        });
        mockMenu = createMockMenuService();
        await module.init({
            database: createMockDatabaseService(),
            serviceRegistry: mockRegistry,
            menuService: mockMenu,
            app: mockApp as never
        });
    });

    describe('metadata', () => {
        it('identifies as the curation module', () => {
            expect(module.metadata.id).toBe('curation');
            expect(module.metadata.name).toBe('Curation');
            expect(module.metadata.version).toBe('1.0.0');
        });
    });

    describe('lifecycle', () => {
        it('does not mount routes or publish the service during init()', () => {
            expect(mockApp.use).not.toHaveBeenCalled();
            expect(mockRegistry.get('curation')).toBeUndefined();
        });

        it('mounts the admin router, publishes the service, and registers the nav item during run()', async () => {
            await module.run();
            expect(mockApp.use).toHaveBeenCalledWith('/api/admin/system/curation', expect.any(Function));
            expect(mockRegistry.get('curation')).toBeDefined();
            expect(mockMenu.create).toHaveBeenCalledWith(expect.objectContaining({ url: '/system/curation' }));
        });

        it('registers the curation gate sink on the content router during run()', async () => {
            await module.run();

            const gate = contentRouter.list().find((sink) => sink.id === 'curation:gate');
            expect(gate).toBeDefined();
            // A gate holds anything: empty accepts, narrowest reach.
            expect(gate?.accepts).toEqual([]);
            expect(gate?.reach).toEqual({ egress: 'internal', audience: 'admin' });
        });

        it('throws when run() is called before init()', async () => {
            await expect(new CurationModule().run()).rejects.toThrow();
        });
    });
});

describe('CurationService', () => {
    /** Build a curation service over a fresh mock database. */
    function makeService(): CurationService {
        const logger = createMockLogger();
        const queue = new CurationQueue(logger, createMockDatabaseService());
        return new CurationService(logger, queue, new ContentRegistry(logger));
    }

    it('registers types and reports them', () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');

        expect(service.hasType('x-poster:tweet')).toBe(true);
        expect(service.getType('x-poster:tweet')).toBe(type);
        expect(service.listTypes()).toEqual([{ typeId: 'x-poster:tweet', label: 'Tweet', providerId: 'x-poster' }]);
    });

    it('holds an effect: caches the preview from describe() and stores it pending', async () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');

        const item = await service.hold({ typeId: 'x-poster:tweet', ref: { postId: 'p1' }, source: 'ai-tool:x-post-tweet' });

        expect(item.status).toBe('pending');
        expect(item.preview.body).toBe('draft p1');
        expect(item.providerId).toBe('x-poster');
        expect(item.source).toBe('ai-tool:x-post-tweet');
        expect(type.describe).toHaveBeenCalledWith({ postId: 'p1' });
        expect(await service.countPending()).toBe(1);
    });

    it('throws when holding for an unregistered type', async () => {
        const service = makeService();
        await expect(service.hold({ typeId: 'nope:thing', ref: {} })).rejects.toThrow(/nope:thing/);
    });

    it('approve records the decision then commits via onApprove', async () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: { postId: 'p1' } });

        const decided = await service.approve(held.id, 'admin-1');

        expect(decided?.status).toBe('approved');
        expect(decided?.decidedBy).toBe('admin-1');
        expect(type.onApprove).toHaveBeenCalledOnce();
        expect(type.onReject).not.toHaveBeenCalled();
        expect(await service.countPending()).toBe(0);
    });

    it('reject records the decision then discards via onReject', async () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        const decided = await service.reject(held.id, 'admin-1');

        expect(decided?.status).toBe('rejected');
        expect(type.onReject).toHaveBeenCalledOnce();
        expect(type.onApprove).not.toHaveBeenCalled();
    });

    it('blocks a decision when the owning type is unregistered, leaving the item pending', async () => {
        const service = makeService();
        const type = spyCurationType();
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        service.unregisterType('x-poster:tweet');
        const decided = await service.approve(held.id, 'admin-1');

        expect(decided).toBeNull();
        expect(type.onApprove).not.toHaveBeenCalled();
        expect(await service.countPending()).toBe(1); // not lost — waits for the owner to return
    });

    it('surfaces a failed commit to the caller while leaving the decision recorded', async () => {
        const service = makeService();
        const type = spyCurationType({ onApprove: vi.fn(async () => { throw new Error('publish failed'); }) });
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        // The commit failure propagates so the curator is not shown a false success...
        await expect(service.approve(held.id, 'admin-1')).rejects.toThrow('publish failed');
        // ...but the decision still stands — the item has left the pending queue.
        expect(await service.countPending()).toBe(0);
    });

    it('resolves a live preview for pending items in listPending and get', async () => {
        const service = makeService();
        let stored = 'v1';
        const type = spyCurationType({ describe: vi.fn(async () => ({ body: stored })) });
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: { postId: 'p1' } });
        expect(held.preview.body).toBe('v1');

        // The provider's record changes out of band; the cached snapshot is stale.
        stored = 'v2';
        expect((await service.listPending())[0].preview.body).toBe('v2');
        expect((await service.get(held.id))?.preview.body).toBe('v2');
    });

    it('edit falls back to the patched body when re-describe fails', async () => {
        const service = makeService();
        let calls = 0;
        const type = spyCurationType({
            describe: vi.fn(async () => {
                calls += 1;
                if (calls === 1) {
                    return { body: 'original', editable: true }; // hold-time snapshot
                }
                throw new Error('describe boom'); // re-describe after the edit
            }),
            applyEdit: vi.fn(async () => undefined)
        });
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        const updated = await service.edit(held.id, { body: 'edited' }, 'admin-1');

        expect(type.applyEdit).toHaveBeenCalledOnce();
        // The edit applied; a failed re-describe must not report failure — fall
        // back to the patched body so the snapshot still advances.
        expect(updated?.preview.body).toBe('edited');
    });

    it('edit applies the patch through the type, then re-derives and re-caches the preview', async () => {
        const service = makeService();
        // Simulate the owning plugin's record: applyEdit mutates it, describe reads it.
        let stored = 'original';
        const type = spyCurationType({
            describe: vi.fn(async () => ({ body: stored, editable: true })),
            applyEdit: vi.fn(async (_ref, patch) => { if (typeof patch.body === 'string') stored = patch.body; })
        });
        service.registerType(type, 'x-poster');
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: { postId: 'p1' } });
        expect(held.preview.body).toBe('original');

        const updated = await service.edit(held.id, { body: 'edited' }, 'admin-1');

        // applyEdit now receives the opaque ref (content self-mutation), not the curation envelope.
        expect(type.applyEdit).toHaveBeenCalledWith(expect.objectContaining({ postId: 'p1' }), { body: 'edited' });
        expect(updated?.preview.body).toBe('edited');
        // The cached snapshot is refreshed too, so the disabled-owner fallback is current.
        expect((await service.get(held.id))?.preview.body).toBe('edited');
        expect(await service.countPending()).toBe(1); // edit does not decide the item
    });

    it('edit returns null for a type that is not editable', async () => {
        const service = makeService();
        service.registerType(spyCurationType(), 'x-poster'); // no applyEdit
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        expect(await service.edit(held.id, { body: 'x' })).toBeNull();
    });
});

describe('CurationService destination selection', () => {
    /** Build a publish-kind sink with a spy `deliver` for fan-out assertions. */
    function makePublishSink(
        id: string,
        accepts: ContentDescriptorFeature[],
        reach: IContentClassification,
        deliver: IContentSink['deliver']
    ): IContentSink {
        return { id, kind: 'publish', accepts, reach, deliver };
    }

    /**
     * Build a curation service wired with a real content router (seeded with the
     * given sinks) and a real defaults store, both over one mock database.
     */
    function makeDestinationService(sinks: IContentSink[]): { service: CurationService } {
        const logger = createMockLogger();
        const db = createMockDatabaseService();
        const queue = new CurationQueue(logger, db);
        const router = new ContentRouter(new ClassificationGate(new AllowAllRoutingPolicy()), logger);
        for (const sink of sinks) {
            router.register(sink, 'core');
        }
        const defaults = new CurationDestinationDefaults(logger, db);
        const service = new CurationService(logger, queue, new ContentRegistry(logger), router, defaults);
        return { service };
    }

    /** A destinations-enabled type rendering a body; ceiling overridable per test. */
    function postType(over: Partial<ICurationType> = {}): ICurationType {
        return spyCurationType({
            typeId: 'media:post',
            label: 'Media Post',
            publishesToDestinations: true,
            describe: vi.fn(async () => ({ body: 'hello world' })),
            ...over
        });
    }

    it('lists eligible publish destinations for a destinations-enabled type', async () => {
        const sink = makePublishSink('core:internal-publish', ['body'], { egress: 'internal', audience: 'admin' }, vi.fn(async () => undefined));
        const { service } = makeDestinationService([sink]);
        service.registerType(postType(), 'media');
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        const eligible = await service.listEligibleDestinations(held.id);
        expect(eligible.map((d) => d.sinkId)).toEqual(['core:internal-publish']);
        expect(eligible[0].defaultSelected).toBe(false);
    });

    it('lists no destinations for a type that does not publish to destinations', async () => {
        const sink = makePublishSink('core:internal-publish', ['body'], { egress: 'internal', audience: 'admin' }, vi.fn());
        const { service } = makeDestinationService([sink]);
        service.registerType(spyCurationType(), 'x-poster'); // no publishesToDestinations
        const held = await service.hold({ typeId: 'x-poster:tweet', ref: {} });

        expect(await service.listEligibleDestinations(held.id)).toEqual([]);
    });

    it('excludes a publish sink whose reach exceeds the type ceiling (gate bounds the picker)', async () => {
        const external = makePublishSink('x:tweet', ['body'], { egress: 'external', audience: 'public' }, vi.fn());
        const { service } = makeDestinationService([external]);
        service.registerType(postType(), 'media'); // no classification → restrictive {internal,admin} ceiling
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        expect(await service.listEligibleDestinations(held.id)).toEqual([]);
    });

    it('includes an external publish sink once the type raises its classification ceiling', async () => {
        const external = makePublishSink('x:tweet', ['body'], { egress: 'external', audience: 'public' }, vi.fn());
        const { service } = makeDestinationService([external]);
        service.registerType(postType({ classification: { egress: 'external', audience: 'public' } }), 'media');
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        expect((await service.listEligibleDestinations(held.id)).map((d) => d.sinkId)).toEqual(['x:tweet']);
    });

    it('excludes a publish sink whose required feature is absent (structural floor)', async () => {
        const mediaSink = makePublishSink('core:media', ['media'], { egress: 'internal', audience: 'admin' }, vi.fn());
        const { service } = makeDestinationService([mediaSink]);
        service.registerType(postType(), 'media'); // body present, no media
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        expect(await service.listEligibleDestinations(held.id)).toEqual([]);
    });

    it('approve fans out to the selected destination, records the outcome, and onApprove observes it', async () => {
        const deliver = vi.fn(async () => undefined);
        const sink = makePublishSink('core:internal-publish', ['body'], { egress: 'internal', audience: 'admin' }, deliver);
        const { service } = makeDestinationService([sink]);
        let onApproveItem: ICurationItem | undefined;
        const type = postType({ onApprove: vi.fn(async (item: ICurationItem) => { onApproveItem = item; }) });
        service.registerType(type, 'media');
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        const decided = await service.approve(held.id, 'admin-1', [{ sinkId: 'core:internal-publish' }]);

        expect(deliver).toHaveBeenCalledOnce();
        expect(decided?.destinations).toEqual([{ sinkId: 'core:internal-publish', status: 'delivered' }]);
        // onApprove runs after fan-out, with the outcomes attached for its bookkeeping.
        expect(onApproveItem?.destinations).toEqual([{ sinkId: 'core:internal-publish', status: 'delivered' }]);
        // The outcomes are persisted on the item.
        expect((await service.get(held.id))?.destinations).toEqual([{ sinkId: 'core:internal-publish', status: 'delivered' }]);
    });

    it('records a failed destination without blocking the decision or onApprove', async () => {
        const deliver = vi.fn(async () => { throw new Error('boom'); });
        const sink = makePublishSink('core:internal-publish', ['body'], { egress: 'internal', audience: 'admin' }, deliver);
        const { service } = makeDestinationService([sink]);
        const type = postType();
        service.registerType(type, 'media');
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        const decided = await service.approve(held.id, 'admin-1', [{ sinkId: 'core:internal-publish' }]);

        expect(decided?.status).toBe('approved');
        expect(decided?.destinations?.[0]).toMatchObject({ sinkId: 'core:internal-publish', status: 'failed', error: 'boom' });
        expect(type.onApprove).toHaveBeenCalledOnce(); // the decision still commits
    });

    it('records a refused destination distinctly from a failure (sink declined, decision still commits)', async () => {
        // A returned refusal — not a throw — is the sink's settled "will not render this",
        // recorded as `refused` with the reason verbatim rather than as a `failed` error.
        const deliver = vi.fn(async () => ({ refused: true as const, reason: 'cannot render this faithfully' }));
        const sink = makePublishSink('core:internal-publish', ['body'], { egress: 'internal', audience: 'admin' }, deliver);
        const { service } = makeDestinationService([sink]);
        const type = postType();
        service.registerType(type, 'media');
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        const decided = await service.approve(held.id, 'admin-1', [{ sinkId: 'core:internal-publish' }]);

        expect(decided?.status).toBe('approved');
        expect(decided?.destinations?.[0]).toMatchObject({
            sinkId: 'core:internal-publish',
            status: 'refused',
            reason: 'cannot render this faithfully'
        });
        expect(decided?.destinations?.[0]).not.toHaveProperty('error'); // a refusal is not a failure
        expect(type.onApprove).toHaveBeenCalledOnce(); // a refusal does not undo the decision
    });

    it('rejects an ineligible destination before recording the decision (item stays pending)', async () => {
        const sink = makePublishSink('core:internal-publish', ['body'], { egress: 'internal', audience: 'admin' }, vi.fn());
        const { service } = makeDestinationService([sink]);
        const type = postType();
        service.registerType(type, 'media');
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        await expect(service.approve(held.id, 'admin-1', [{ sinkId: 'core:nonexistent' }])).rejects.toThrow(/not an eligible publish destination/);
        expect(type.onApprove).not.toHaveBeenCalled();
        expect(await service.countPending()).toBe(1);
    });

    it('pre-selects a destination saved as the type default', async () => {
        const sink = makePublishSink('core:internal-publish', ['body'], { egress: 'internal', audience: 'admin' }, vi.fn());
        const { service } = makeDestinationService([sink]);
        service.registerType(postType(), 'media');
        await service.setDestinationDefaults('media:post', ['core:internal-publish']);
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        const eligible = await service.listEligibleDestinations(held.id);
        expect(eligible[0]).toMatchObject({ sinkId: 'core:internal-publish', defaultSelected: true });
        expect(await service.getDestinationDefaults('media:post')).toEqual(['core:internal-publish']);
    });

    it('a classic approve with no destinations leaves destinations unset', async () => {
        const sink = makePublishSink('core:internal-publish', ['body'], { egress: 'internal', audience: 'admin' }, vi.fn());
        const { service } = makeDestinationService([sink]);
        service.registerType(postType(), 'media');
        const held = await service.hold({ typeId: 'media:post', ref: {} });

        const decided = await service.approve(held.id, 'admin-1');
        expect(decided?.status).toBe('approved');
        expect(decided?.destinations).toBeUndefined();
    });
});

describe('curation auto-approve context', () => {
    it('reports no auto-approval outside a governed scope', () => {
        expect(shouldAutoApproveCuration()).toBe(false);
    });

    it('clears the auto-approve scope once the governed execution settles, so a detached handler cannot auto-approve', async () => {
        // Models the timeout race: the governed call (fn) settles while a
        // handler continuation keeps running and only holds its effect
        // afterward. The detached continuation shares the same async context,
        // so it must observe the scope as no longer live.
        let detachedSawAutoApprove: boolean | null = null;
        let releaseDetached: (() => void) | null = null;
        const detached = new Promise<void>((resolve) => { releaseDetached = resolve; });

        await runWithCurationAutoApprove(true, async () => {
            // Inside the live scope, auto-approve is in effect.
            expect(shouldAutoApproveCuration()).toBe(true);
            // A continuation that resolves only after fn returns — a handler
            // that outran the governor's timeout.
            void detached.then(() => { detachedSawAutoApprove = shouldAutoApproveCuration(); });
            // fn settles now (as if runWithTimeout rejected on timeout).
        });

        // Now let the detached continuation run, after the governed call returned.
        releaseDetached!();
        await detached;
        await Promise.resolve();

        expect(detachedSawAutoApprove).toBe(false);
    });
});
