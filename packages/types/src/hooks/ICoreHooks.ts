/**
 * @fileoverview Shape of the central `HOOKS` registry, exposed to plugins
 * through `IPluginHooks.HOOKS`.
 *
 * The runtime registry lives in `src/backend/hooks/registry.ts` (core). Each
 * descriptor minted there is an object reference tracked by the
 * `defineHook` known-descriptor set; the runtime `HookRegistry.register`
 * refuses any descriptor it did not see produced by that factory. Plugins
 * therefore cannot fabricate their own descriptors — they must reach the
 * exact runtime objects.
 *
 * Plugins live in workspaces that do not have a TypeScript path alias into
 * core, so importing `HOOKS` directly is not possible. Instead the plugin
 * facade carries a reference: `context.hooks.HOOKS.ssr.headFragments`
 * returns the same runtime descriptor that `src/backend/hooks/registry.ts`
 * minted, with this interface providing the compile-time shape.
 *
 * Adding a new seam therefore requires three coordinated edits: declare
 * the descriptor in `registry.ts`, extend this interface to mirror the
 * shape, and re-export the type through `packages/types/src/hooks/index.ts`.
 * The asymmetry is intentional — a seam is part of the platform contract,
 * not a private detail.
 *
 * @see {@link ../../../../src/backend/hooks/registry.ts} for the runtime
 *   registry that satisfies this interface.
 * @see {@link ../../../../docs/system/system-hooks.md} for archetypes and
 *   the full plugin-author flow.
 * @module types/hooks/ICoreHooks
 */

import type { HookDescriptor } from './HookDescriptor.js';
import type { ISsrHeadContext } from '../ssr/ISsrHeadContext.js';
import type { IHeadFragment } from '../ssr/IHeadFragment.js';
import type { IAiToolInvokeContext } from '../ai-tools/IAiToolHookContext.js';
import type { IToolInvocationRecord } from '../ai-tools/IToolInvocationRecord.js';

/**
 * SSR-phase declared seams. Mirrors the `HOOKS.ssr` object in core's
 * `registry.ts`. Every property here is a runtime descriptor; consumers
 * pass these references into `context.hooks.register(...)`.
 */
export interface ICoreSsrHooks {
    /**
     * Stamp attributes onto the rendered root `<html>` element. Handlers
     * receive the request context plus the current attribute map and
     * return the next map (conventionally by spreading the input then
     * overriding their own keys). Seeded with `{ lang: 'en' }`.
     */
    readonly htmlAttributes: HookDescriptor<
        ISsrHeadContext,
        Readonly<Record<string, string>>,
        'waterfall'
    >;

    /**
     * Contribute `<style>` / `<link>` / `<meta>` / `<script>` fragments to
     * the rendered `<head>`. Handlers receive the request context plus
     * the current fragment list and return the next list (conventionally
     * by concatenating their own contributions onto the input).
     */
    readonly headFragments: HookDescriptor<
        ISsrHeadContext,
        ReadonlyArray<IHeadFragment>,
        'waterfall'
    >;
}

/**
 * AI-tool-phase declared seams. Mirrors the `HOOKS.ai` object in core's
 * `registry.ts`. The AI tool governor invokes these around every governed
 * tool call, regardless of which AI provider plugin drove it.
 */
export interface ICoreAiHooks {
    /**
     * Series seam fired before a governed tool runs — after schema validation,
     * before execution. A handler throws `HookAbortError` to veto or hold the
     * call; the governor surfaces the abort to the model as a denial.
     */
    readonly toolInvoke: HookDescriptor<IAiToolInvokeContext, void, 'series'>;

    /**
     * Observer seam fired after a governed tool call completes, with the full
     * invocation record. For audit fan-out, alerting, and lethal-trifecta
     * watch — handlers cannot change the outcome.
     */
    readonly toolInvoked: HookDescriptor<IToolInvocationRecord, void, 'observer'>;
}

/**
 * Aggregate shape of every declared seam, grouped by pipeline phase.
 *
 * The remaining phases (`http`, `websocket`, `scheduler`, `observer`) are
 * declared as empty marker objects so adding the first seam in those
 * phases is a one-line interface extension instead of a structural
 * surprise for existing consumers.
 */
export interface ICoreHooks {
    readonly ssr: ICoreSsrHooks;
    readonly ai: ICoreAiHooks;
    readonly http: Readonly<Record<string, never>>;
    readonly websocket: Readonly<Record<string, never>>;
    readonly scheduler: Readonly<Record<string, never>>;
    readonly observer: Readonly<Record<string, never>>;
}
