/**
 * @file ai-tools.router.test.ts
 *
 * Locks the `requireAdminUser` gate onto the exact set of admin routes that
 * earn it, by introspecting the assembled Express router rather than by
 * exercising each handler.
 *
 * The gate protects a *capability* — reading a `secret` prompt variable's
 * value — that has more than one door, and the failure mode is silent: dropping
 * the middleware from one route leaves every test that exercises the handler
 * passing, because the handler itself never changed. That already happened once
 * here (the saved-prompt save/run pair reaches the same provider-side `{%name%}`
 * expansion `POST /query` does, and was missed on the first pass), which is why
 * the gated set is asserted as a whole set rather than route by route: an
 * assertion that only checks the routes someone remembered cannot catch the
 * route they forgot.
 */

/// <reference types="vitest" />

import { describe, it, expect } from 'vitest';
import type { Router } from 'express';
import { createAiToolsAdminRouter } from '../api/ai-tools.router.js';
import type { AiToolsController } from '../api/ai-tools.controller.js';

/**
 * One mounted route, reduced to what this suite asserts on.
 */
interface IMountedRoute {
    /** HTTP method, upper-cased (`GET`, `POST`, …). */
    method: string;

    /** Path as registered on the router, relative to its mount point. */
    path: string;

    /** Whether `requireAdminUser` sits in this route's middleware chain. */
    sessionOnly: boolean;
}

/**
 * Express layer shape this suite reads. Typed locally because Express's own
 * types do not expose the router stack, and reaching into it is the only way to
 * assert *which* middleware guards a route without invoking every handler.
 */
interface IRouterLayer {
    route?: {
        path: string;
        methods: Record<string, boolean>;
        stack: Array<{ name: string }>;
    };
}

/**
 * Flatten the router's internal stack into an assertable list of routes.
 *
 * Reads middleware identity from each handler's function `name`, which is why
 * `requireAdminUser` must stay a named function export — an inline arrow or a
 * re-wrapping decorator would erase the name this detection depends on.
 *
 * @param router - The assembled admin router to introspect.
 * @returns Every mounted route with its method, path, and gate status.
 */
function collectRoutes(router: Router): IMountedRoute[] {
    const layers = (router as unknown as { stack: IRouterLayer[] }).stack;
    const routes: IMountedRoute[] = [];
    for (const layer of layers) {
        if (!layer.route) {
            continue;
        }
        const method = Object.keys(layer.route.methods)[0]?.toUpperCase() ?? 'ALL';
        routes.push({
            method,
            path: layer.route.path,
            sessionOnly: layer.route.stack.some(handler => handler.name === 'requireAdminUser')
        });
    }
    return routes;
}

/**
 * Every route that must refuse the `ADMIN_API_TOKEN` service path, as
 * `METHOD path` strings.
 *
 * Two kinds qualify. The secret-read paths: resolving a variable directly, the
 * bulk listing (which embeds each static's `content`, and a new static defaults
 * to `secret`), running a query whose prompt may contain `{%name%}`, reading the
 * persisted answer to such a query, and saving or running a saved prompt — a
 * stored query whose registry tokens expand at fire time, and which fires on its
 * own trigger even when saved by an unowned service-token call. And the policy
 * writes, which take a safety gate off rather than read a secret.
 */
const EXPECTED_SESSION_ONLY = [
    'GET /variables',
    'GET /variables/:name/value',
    'POST /query',
    'GET /query/history',
    'GET /query/conversations/:conversationId',
    'POST /query/prompts',
    'POST /query/prompts/:id/run',
    'PUT /policy/:name',
    'DELETE /policy/:name'
].sort();

/**
 * Build a controller stand-in whose every handler is an inert function.
 *
 * The router only stores handler references, so the doubles need no behaviour —
 * but they must be distinct named functions rather than one shared spy, so a
 * handler is never mistaken for the `requireAdminUser` middleware by name.
 *
 * @returns A controller double satisfying the router factory's parameter type.
 */
function createControllerStub(): AiToolsController {
    return new Proxy({} as AiToolsController, {
        get: () => function handlerStub(): void {}
    });
}

describe('createAiToolsAdminRouter — requireAdminUser coverage', () => {
    const routes = collectRoutes(createAiToolsAdminRouter(createControllerStub()));

    it('gates exactly the routes that reach a secret or relax a safety gate', () => {
        const gated = routes
            .filter(route => route.sessionOnly)
            .map(route => `${route.method} ${route.path}`)
            .sort();
        expect(gated).toEqual(EXPECTED_SESSION_ONLY);
    });

    it('gates saving and running a saved prompt, which expand registry tokens like a query', () => {
        const savePrompt = routes.find(r => r.method === 'POST' && r.path === '/query/prompts');
        const runPrompt = routes.find(r => r.method === 'POST' && r.path === '/query/prompts/:id/run');
        expect(savePrompt?.sessionOnly).toBe(true);
        expect(runPrompt?.sessionOnly).toBe(true);
    });

    it('leaves the policy read on the shared gate so a monitor can still observe posture', () => {
        const readPolicy = routes.find(r => r.method === 'GET' && r.path === '/policy');
        expect(readPolicy).toBeDefined();
        expect(readPolicy?.sessionOnly).toBe(false);
    });

    it('leaves listing saved prompts open — a stored template holds the token, not the value', () => {
        const listPrompts = routes.find(r => r.method === 'GET' && r.path === '/query/prompts');
        expect(listPrompts?.sessionOnly).toBe(false);
    });
});
