/**
 * @fileoverview Contract tests for the content router primitive, the
 * classification gate, and the governed `fields` key registry.
 *
 * These prove the load-bearing invariants of the design: registration refuses an
 * unknown classification (fail-fast); the gate admits a sink only when its reach
 * is contained by the content's ceiling (`reach ≤ classification`, INCLUDING the
 * inverse cases that would be the direction bug); structural matching is
 * `accepts ⊆ present`; a sink renders a content type authored after it (graceful
 * degradation); and reading an undeclared `fields` key fails the build.
 */

import { describe, it, expect } from 'vitest';
import type {
    ISystemLogService,
    IContentSink,
    IContentClassification,
    IContentRoutingPolicy,
    IContentDescriptor,
    IContentType,
    ContentDescriptorFeature
} from '@/types';
import { readContentField } from '@/types';
import { ContentRouter } from '../content-router.js';
import { ClassificationGate, AllowAllRoutingPolicy } from '../content-routing-gate.js';

/** No-op logger satisfying ISystemLogService, mirroring the content-types test. */
function silentLogger(): ISystemLogService {
    const noop = (): void => undefined;
    const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => logger } as unknown as ISystemLogService;
    return logger;
}

/**
 * Build a router whose gate uses the allow-all policy — the production wiring for
 * this slice. Tests that need a denying policy construct their own gate.
 */
function makeRouter(): ContentRouter {
    return new ContentRouter(new ClassificationGate(new AllowAllRoutingPolicy()), silentLogger());
}

/**
 * Build a sink stub. `deliver` defaults to a no-op so tests that only exercise
 * registration and routing need not supply one; tests that assert delivery
 * behaviour pass their own.
 */
function makeSink(
    id: string,
    accepts: ContentDescriptorFeature[],
    reach: IContentClassification,
    deliver?: IContentSink['deliver']
): IContentSink {
    return { id, accepts, reach, deliver: deliver ?? (async () => undefined) };
}

describe('ContentRouter registration', () => {
    it('registers a sink, projects it without the deliver callback, and disposes it', () => {
        const router = makeRouter();
        const disposer = router.register(makeSink('twitter', ['body'], { egress: 'external', audience: 'public' }), 'trp-x-poster');

        expect(router.getSinks()).toHaveLength(1);
        // The exact-shape toEqual is also the leak check: the projection carries
        // only id/accepts/reach/providerId — no deliver callback.
        const info = router.list();
        expect(info).toEqual([
            { id: 'twitter', accepts: ['body'], reach: { egress: 'external', audience: 'public' }, providerId: 'trp-x-poster' }
        ]);

        disposer();
        expect(router.getSinks()).toHaveLength(0);
    });

    it('replaces a sink registered under the same id (idempotent hot-reload)', () => {
        const router = makeRouter();
        router.register(makeSink('toast', ['title'], { egress: 'user', audience: 'user' }), 'core');
        router.register(makeSink('toast', ['title', 'body'], { egress: 'user', audience: 'user' }), 'core');

        expect(router.getSinks()).toHaveLength(1);
        expect(router.list()[0].accepts).toEqual(['title', 'body']);
    });

    it('a stale disposer does not remove a newer registration of the same id', () => {
        const router = makeRouter();
        const staleDisposer = router.register(makeSink('toast', ['title'], { egress: 'user', audience: 'user' }), 'core');
        router.register(makeSink('toast', ['body'], { egress: 'user', audience: 'user' }), 'core');

        staleDisposer();

        // The newer registration still owns the slot.
        expect(router.getSinks()).toHaveLength(1);
        expect(router.list()[0].accepts).toEqual(['body']);
    });

    it('refuses a sink whose reach uses an unknown level (fail-fast)', () => {
        const router = makeRouter();
        const bad = makeSink('rogue', ['body'], { egress: 'galactic', audience: 'public' } as unknown as IContentClassification);

        expect(() => router.register(bad, 'plugin')).toThrow(/Unknown egress level 'galactic'/);
        expect(router.getSinks()).toHaveLength(0);
    });

    it('refuses a sink whose reach declares an unknown dimension', () => {
        const router = makeRouter();
        const bad = makeSink('rogue', ['body'], { egress: 'external', audience: 'public', clearance: 'top-secret' } as unknown as IContentClassification);

        expect(() => router.register(bad, 'plugin')).toThrow(/Unknown classification dimension 'clearance'/);
    });

    it('refuses a sink that accepts an unknown descriptor feature', () => {
        const router = makeRouter();
        const bad = makeSink('rogue', ['body', 'sidecar' as ContentDescriptorFeature], { egress: 'user', audience: 'user' });

        expect(() => router.register(bad, 'plugin')).toThrow(/Unknown descriptor feature 'sidecar'/);
    });
});

describe('ClassificationGate admission', () => {
    const gate = new ClassificationGate(new AllowAllRoutingPolicy());
    const twitter = makeSink('twitter', ['body'], { egress: 'external', audience: 'public' });
    const audit = makeSink('audit', ['body'], { egress: 'internal', audience: 'admin' });

    it('admits a sink whose reach equals the ceiling', () => {
        const admitted = gate.admit({ egress: 'external', audience: 'public' }, [twitter]);
        expect(admitted.map((s) => s.id)).toEqual(['twitter']);
    });

    it('admits a sink whose reach is below the ceiling on every dimension', () => {
        // A {external,public} ceiling caps the maximum; a lower-reach sink is still allowed.
        const admitted = gate.admit({ egress: 'external', audience: 'public' }, [audit]);
        expect(admitted.map((s) => s.id)).toEqual(['audit']);
    });

    it('does NOT admit an external/public sink for internal/admin content (the direction guard)', () => {
        // The inverse case: containment is reach ≤ ceiling, never the reverse. An
        // {internal,admin} audit record must never become a candidate for Twitter.
        const admitted = gate.admit({ egress: 'internal', audience: 'admin' }, [twitter]);
        expect(admitted).toEqual([]);
    });

    it('evaluates the two dimensions independently (componentwise)', () => {
        const userPublic = makeSink('userPublic', ['body'], { egress: 'user', audience: 'public' });
        const userAdmin = makeSink('userAdmin', ['body'], { egress: 'user', audience: 'admin' });

        // Ceiling {external, admin}: egress permits user; audience caps at admin, so public is over.
        const admitted = gate.admit({ egress: 'external', audience: 'admin' }, [userPublic, userAdmin]);
        expect(admitted.map((s) => s.id)).toEqual(['userAdmin']);
    });

    it('consults the policy seam — a denying policy excludes an otherwise-contained sink', () => {
        /** Denies any reach that leaves the platform, proving the gate calls permits(). */
        const noExternal: IContentRoutingPolicy = { permits: (reach) => reach.egress !== 'external' };
        const denyingGate = new ClassificationGate(noExternal);

        const admitted = denyingGate.admit({ egress: 'external', audience: 'public' }, [twitter, audit]);
        expect(admitted.map((s) => s.id)).toEqual(['audit']);
    });

    it('fails closed when the ceiling carries an unknown level', () => {
        const admitted = gate.admit({ egress: 'galactic', audience: 'public' } as unknown as IContentClassification, [twitter]);
        expect(admitted).toEqual([]);
    });
});

describe('ContentRouter structural candidates', () => {
    const router = makeRouter();
    const bodyOnly = makeSink('bodyOnly', ['body'], { egress: 'external', audience: 'public' });
    const bodyAndMedia = makeSink('bodyAndMedia', ['body', 'media'], { egress: 'external', audience: 'public' });
    const titleOnly = makeSink('titleOnly', ['title'], { egress: 'external', audience: 'public' });

    it('matches a sink when every accepted feature is present (accepts ⊆ present)', () => {
        const matched = router.candidates(['title', 'body', 'media'], [bodyOnly, bodyAndMedia, titleOnly]);
        // All three are satisfied: their accepts are subsets of the present features.
        expect(matched.map((s) => s.id)).toEqual(['bodyOnly', 'bodyAndMedia', 'titleOnly']);
    });

    it('excludes a sink whose accepted feature is absent', () => {
        // present = {body} only: bodyAndMedia needs media (absent), titleOnly needs title (absent).
        const matched = router.candidates(['body'], [bodyOnly, bodyAndMedia, titleOnly]);
        expect(matched.map((s) => s.id)).toEqual(['bodyOnly']);
    });

    it('route() composes the gate then the structural match', () => {
        const r = makeRouter();
        r.register(bodyOnly, 'trp-x-poster');
        r.register(makeSink('audit', ['body'], { egress: 'internal', audience: 'admin' }), 'core');

        // {external,public} content with a body: both the external sink and the
        // lower-reach internal sink are admitted, and both structurally match.
        const wide = r.route({ egress: 'external', audience: 'public' }, ['body']);
        expect(wide.map((s) => s.id).sort()).toEqual(['audit', 'bodyOnly']);

        // {internal,admin} content: the external sink's reach exceeds the ceiling,
        // so only the internal sink survives — the ceiling caps exposure.
        const narrow = r.route({ egress: 'internal', audience: 'admin' }, ['body']);
        expect(narrow.map((s) => s.id)).toEqual(['audit']);
    });
});

describe('Graceful degradation — a sink renders a content type authored after it', () => {
    it('delivers a compatible type with zero type-specific code, reading only the descriptor', async () => {
        let deliveredBody: string | undefined;
        let deliveredHandle: unknown;

        // The sink predates any content type below and references no typeId — it
        // reads only the descriptor and the admin-supplied destination config.
        const twitter = makeSink('twitter', ['body'], { egress: 'external', audience: 'public' }, async (content, dest) => {
            deliveredBody = content.body;
            deliveredHandle = dest.handle;
        });

        const router = makeRouter();
        router.register(twitter, 'trp-x-poster');

        // A content type "authored after" the sink. The sink has never heard of it.
        const announcement: IContentType = {
            typeId: 'media:announcement',
            label: 'Announcement',
            describe: (): IContentDescriptor => ({ body: 'Mainnet upgrade shipped' })
        };
        const descriptor = await announcement.describe({});
        const present = (Object.keys(descriptor) as ContentDescriptorFeature[]).filter(
            (k): k is ContentDescriptorFeature => ['title', 'body', 'media', 'details'].includes(k) && descriptor[k as keyof IContentDescriptor] != null
        );

        const candidates = router.route({ egress: 'external', audience: 'public' }, present);
        expect(candidates.map((s) => s.id)).toEqual(['twitter']);

        await candidates[0].deliver(descriptor, { handle: '@tronrelic' });
        expect(deliveredBody).toBe('Mainnet upgrade shipped');
        expect(deliveredHandle).toBe('@tronrelic');
    });
});

describe('Governed fields key registry', () => {
    it('reads a declared key through the typed accessor', () => {
        const descriptor: IContentDescriptor = { body: 'see more', fields: { canonicalUrl: 'https://tronrelic.com/x' } };
        expect(readContentField(descriptor.fields, 'canonicalUrl')).toBe('https://tronrelic.com/x');
    });

    it('returns undefined for an absent map or an unset declared key', () => {
        expect(readContentField(undefined, 'canonicalUrl')).toBeUndefined();
        expect(readContentField({}, 'canonicalUrl')).toBeUndefined();
    });

    it('rejects an undeclared key at compile time (governance — undeclared key is a build error)', () => {
        const descriptor: IContentDescriptor = { fields: { canonicalUrl: 'https://tronrelic.com/x' } };
        // @ts-expect-error 'threadId' is not declared in IContentFields; reading it must fail the build.
        const leaked = readContentField(descriptor.fields, 'threadId');
        expect(leaked).toBeUndefined();
    });
});
