/// <reference types="vitest" />

/**
 * Ordering guarantees for the plugin route middleware chain.
 *
 * These tests exist because the order is a security property rather than a
 * stylistic one. Route middleware may consume real resources on the caller's
 * behalf before the handler runs — the Files plugin mounts a 100MB in-memory
 * multipart parser on its upload route — so a gate mounted after that
 * middleware lets an anonymous caller drive the expensive work to completion
 * and only then collect a 401. The assertions below pin the gate to the front
 * of the chain, and pin the complementary case: an ungated route still runs
 * its own middleware, which is why a public route's middleware has to be cheap
 * and self-limiting.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import express from 'express';
import type { Request, Response, NextFunction } from 'express';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { IPlugin, ApiMiddleware, IApiRouteConfig, IHttpRequest, IHttpResponse } from '@/types';

/** Records the chain as it executes so assertions can read the real order. */
const callOrder: string[] = [];

/** Set by each test to decide whether the mocked admin gate admits the call. */
let adminGateAdmits = false;

vi.mock('../../lib/logger.js', () => ({
    logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
        debug: vi.fn(),
        trace: vi.fn(),
        fatal: vi.fn()
    }
}));

vi.mock('../../api/middleware/admin-auth.js', () => ({
    requireAdmin: (_req: Request, res: Response, next: NextFunction) => {
        callOrder.push('gate:admin');
        if (!adminGateAdmits) {
            res.status(401).json({ error: 'Admin authentication required' });
            return;
        }
        next();
    }
}));

vi.mock('../../api/middleware/require-login.js', () => ({
    requireLogin: (_req: Request, res: Response, next: NextFunction) => {
        callOrder.push('gate:login');
        res.status(401).json({ error: 'Authentication required' });
    }
}));

const { PluginApiService } = await import('../plugin-api.service.js');

/**
 * Route middleware stand-in for the expensive work a real plugin performs
 * before its handler — body buffering, an upstream call, a cache warm. It only
 * records that it ran, which is the whole question these tests ask.
 */
const recordingMiddleware: ApiMiddleware = (_req, _res, next) => {
    callOrder.push('route-middleware');
    next();
};

/**
 * Terminal handler shared by every fixture route. Records that control reached
 * the end of the chain, which is what distinguishes "gate rejected the call"
 * from "gate admitted it and everything ran in order".
 *
 * @param _req - Unused; the fixture asserts on ordering, not request contents
 * @param res - Used to close the response so the test's fetch resolves
 */
const recordingHandler = async (_req: IHttpRequest, res: IHttpResponse): Promise<void> => {
    callOrder.push('handler');
    res.json({ ok: true });
};

/**
 * Minimal plugin definition exercising the three cases that matter: an admin
 * route carrying middleware, a login-gated route carrying middleware, and an
 * ungated public route carrying middleware.
 *
 * @returns A plugin shaped enough for `registerPluginRoutes` to consume
 */
function buildTestPlugin(): IPlugin {
    const routes: IApiRouteConfig[] = [
        {
            method: 'GET',
            path: '/public',
            middleware: [recordingMiddleware],
            handler: recordingHandler
        },
        {
            method: 'GET',
            path: '/members',
            requiresAuth: true,
            middleware: [recordingMiddleware],
            handler: recordingHandler
        }
    ];

    const adminRoutes: IApiRouteConfig[] = [
        {
            method: 'GET',
            path: '/upload',
            middleware: [recordingMiddleware],
            handler: recordingHandler
        }
    ];

    return {
        manifest: { id: 'order-fixture', title: 'Order Fixture' },
        routes,
        adminRoutes
    } as unknown as IPlugin;
}

describe('PluginApiService middleware ordering', () => {
    let server: Server;
    let baseUrl: string;

    beforeEach(async () => {
        callOrder.length = 0;
        adminGateAdmits = false;

        const service = PluginApiService.getInstance();
        service.clear();
        service.registerPluginRoutes(buildTestPlugin());

        const app = express();
        app.use('/api/plugins', service.getRouter());

        server = createServer(app);
        await new Promise<void>(resolve => server.listen(0, resolve));
        baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/plugins/order-fixture`;
    });

    afterEach(async () => {
        PluginApiService.getInstance().clear();
        await new Promise<void>(resolve => server.close(() => resolve()));
    });

    it('rejects an unauthorized admin request before its route middleware runs', async () => {
        const response = await fetch(`${baseUrl}/system/upload`);

        expect(response.status).toBe(401);
        expect(callOrder).toEqual(['gate:admin']);
    });

    it('runs route middleware after the gate once the admin gate admits the call', async () => {
        adminGateAdmits = true;

        const response = await fetch(`${baseUrl}/system/upload`);

        expect(response.status).toBe(200);
        expect(callOrder).toEqual(['gate:admin', 'route-middleware', 'handler']);
    });

    it('rejects an anonymous login-gated request before its route middleware runs', async () => {
        const response = await fetch(`${baseUrl}/members`);

        expect(response.status).toBe(401);
        expect(callOrder).toEqual(['gate:login']);
    });

    it('still runs route middleware first on an ungated public route', async () => {
        const response = await fetch(`${baseUrl}/public`);

        expect(response.status).toBe(200);
        expect(callOrder).toEqual(['route-middleware', 'handler']);
    });
});
