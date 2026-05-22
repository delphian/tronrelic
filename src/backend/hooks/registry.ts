/**
 * @fileoverview Central declared-hook registry.
 *
 * This file is the single source of truth for every extension point the
 * core pipeline exposes to plugins. Adding a new hook requires editing
 * this file — there is no other sanctioned way to mint a descriptor,
 * because `defineHook` tracks the descriptor in a module-local set that
 * the runtime registry checks before accepting any registration.
 *
 * Style:
 *
 * - Group by phase (`ssr`, `http`, `websocket`, `scheduler`, `observer`).
 * - Use camelCase keys within a phase.
 * - Dotted ids follow `<phase>.<name>` exactly.
 * - Numeric `order` values use gaps of 10–100 so additions can slot
 *   between existing entries without renumbering.
 *
 * @see {@link ../../../docs/system/system-hooks.md} for the conceptual
 *   contract: archetypes, lifecycle window, isolation, abort semantics,
 *   and the `/system/hooks` admin introspection surface.
 * @module backend/hooks/registry
 */

import type { IHeadFragment, ISsrHeadContext } from '@/types';
import { defineHook } from './define-hook.js';

/**
 * Declared hooks, organized by pipeline phase. Core modules and call
 * sites import this object directly. Plugins reach the same runtime
 * descriptors through `context.hooks.HOOKS` (typed by `ICoreHooks` in
 * the types package) because plugin workspaces have no path alias into
 * `src/backend/hooks/` — the facade re-exposes this registry so the
 * descriptor identity passes `defineHook`'s known-set check.
 */
export const HOOKS = {
    ssr: {
        /**
         * Waterfall that aggregates attributes stamped on the root
         * `<html>` element of every SSR-rendered page. Handlers receive
         * the request context plus the current attribute map and return
         * the next map — conventionally by merging their own keys onto
         * the input.
         *
         * Seeded with `{ lang: 'en' }` by the SSR endpoint. Themes,
         * locale switchers, A/B markers, and analytics surface ids all
         * belong on this seam.
         *
         * Ordered before `ssr.headFragments` in the timeline because
         * the `<html>` tag's attributes appear first in the serialized
         * HTML output — operators reading the admin timeline see the
         * seams in the order their effects show up on the page.
         */
        htmlAttributes: defineHook<ISsrHeadContext, Readonly<Record<string, string>>, 'waterfall'>({
            id: 'ssr.htmlAttributes',
            kind: 'waterfall',
            phase: 'ssr.page',
            order: 100,
            description:
                'Stamp attributes onto the root <html> element. Handlers receive the request path, ' +
                'cookies, and query, and thread a string-keyed attribute map through the pipeline. ' +
                'Last writer wins per attribute key.'
        }),
        /**
         * Waterfall that aggregates contributions to the SSR-rendered
         * `<head>`. Handlers receive the request context plus the
         * current fragment list and return the next list — conventionally
         * by concatenating their own contributions onto the input.
         *
         * Seeded with an empty array by the SSR endpoint. Themes,
         * analytics beacons, structured-data emitters, and CSP nonce
         * injectors all belong on this seam.
         */
        headFragments: defineHook<ISsrHeadContext, ReadonlyArray<IHeadFragment>, 'waterfall'>({
            id: 'ssr.headFragments',
            kind: 'waterfall',
            phase: 'ssr.page',
            order: 200,
            description:
                'Contribute <style>, <link>, <meta>, or <script> elements to the rendered <head>. ' +
                'Handlers receive the request path, cookies, and query, and thread an array of head ' +
                'fragments through the pipeline.'
        })
    },
    http: {} as Record<string, never>,
    websocket: {} as Record<string, never>,
    scheduler: {} as Record<string, never>,
    observer: {} as Record<string, never>
} as const;

/**
 * Type alias re-exported for ergonomic imports at core call sites.
 */
export type Hooks = typeof HOOKS;
