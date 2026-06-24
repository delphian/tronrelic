/**
 * @fileoverview Tests for the content-router introspection controller: it lists
 * every registered sink, and — when the request supplies a classification —
 * computes the gate's admitted set and (with features) the structural candidates.
 * A malformed classification is a 400 so an operator typo is reported, not
 * silently treated as "no candidates".
 */

import { describe, it, expect, vi } from 'vitest';
import type { Request, Response } from 'express';
import type { ISystemLogService, IContentClassification, ContentDescriptorFeature } from '@/types';
import { ContentRouter } from '../content-router.js';
import { ClassificationGate, AllowAllRoutingPolicy } from '../content-routing-gate.js';
import { ContentRouterController } from '../content-router-admin.js';

/** No-op logger satisfying ISystemLogService. */
function silentLogger(): ISystemLogService {
    const noop = (): void => undefined;
    const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => logger } as unknown as ISystemLogService;
    return logger;
}

/** A router seeded with one external and one internal sink, both body-rendering. */
function seededRouter(): ContentRouter {
    const router = new ContentRouter(new ClassificationGate(new AllowAllRoutingPolicy()), silentLogger());
    router.register(
        { id: 'twitter', kind: 'publish', accepts: ['body'] as ContentDescriptorFeature[], reach: { egress: 'external', audience: 'public' }, deliver: async () => undefined },
        'trp-x-poster'
    );
    router.register(
        { id: 'audit', kind: 'publish', accepts: ['body'] as ContentDescriptorFeature[], reach: { egress: 'internal', audience: 'admin' }, deliver: async () => undefined },
        'core'
    );
    return router;
}

/** A chainable Express response mock whose `status` returns itself so `status().json()` works. */
function mockResponse(): { res: Response; json: ReturnType<typeof vi.fn>; status: ReturnType<typeof vi.fn> } {
    const json = vi.fn();
    const status = vi.fn();
    const res = { json, status } as unknown as Response;
    status.mockReturnValue(res);
    return { res, json, status };
}

describe('ContentRouterController', () => {
    it('lists every registered sink when no classification is supplied', () => {
        const controller = new ContentRouterController(seededRouter());
        const { res, json } = mockResponse();

        controller.getSnapshot({ query: {} } as unknown as Request, res);

        const payload = json.mock.calls[0][0] as { sinks: Array<{ id: string }>; admitted?: string[] };
        expect(payload.sinks.map((s) => s.id).sort()).toEqual(['audit', 'twitter']);
        expect(payload.admitted).toBeUndefined();
    });

    it('computes the admitted set for a supplied classification', () => {
        const controller = new ContentRouterController(seededRouter());
        const { res, json } = mockResponse();

        // {internal,admin} content: the external twitter sink is over the ceiling.
        controller.getSnapshot({ query: { egress: 'internal', audience: 'admin' } } as unknown as Request, res);

        const payload = json.mock.calls[0][0] as { classification: IContentClassification; admitted: string[]; candidates?: string[] };
        expect(payload.classification).toEqual({ egress: 'internal', audience: 'admin' });
        expect(payload.admitted).toEqual(['audit']);
        expect(payload.candidates).toBeUndefined();
    });

    it('computes structural candidates when features are also supplied', () => {
        const controller = new ContentRouterController(seededRouter());
        const { res, json } = mockResponse();

        controller.getSnapshot(
            { query: { egress: 'external', audience: 'public', features: 'body' } } as unknown as Request,
            res
        );

        const payload = json.mock.calls[0][0] as { admitted: string[]; features: string[]; candidates: string[] };
        // {external,public} admits both; both accept only body, which is present.
        expect(payload.admitted.sort()).toEqual(['audit', 'twitter']);
        expect(payload.features).toEqual(['body']);
        expect(payload.candidates.sort()).toEqual(['audit', 'twitter']);
    });

    it('returns 400 for a malformed classification rather than silently empty', () => {
        const controller = new ContentRouterController(seededRouter());
        const { res, json, status } = mockResponse();

        controller.getSnapshot({ query: { egress: 'galactic', audience: 'public' } } as unknown as Request, res);

        expect(status).toHaveBeenCalledWith(400);
        expect(json.mock.calls[0][0]).toHaveProperty('error');
    });

    it('returns 400 when only one classification dimension is supplied', () => {
        const controller = new ContentRouterController(seededRouter());
        const { res, status } = mockResponse();

        controller.getSnapshot({ query: { egress: 'external' } } as unknown as Request, res);

        expect(status).toHaveBeenCalledWith(400);
    });
});
