/**
 * @fileoverview Controller backing the public SSR html-attributes endpoint.
 *
 * Bridges the Next.js SSR layer to the `HOOKS.ssr.htmlAttributes`
 * waterfall: parses request context from the POST body, seeds the
 * pipeline with `{ lang: 'en' }`, invokes the hook, and returns the
 * aggregated attribute map. Themes, locale switchers, and any other
 * `<html>`-attribute contributor surface here.
 *
 * Like the head-fragments endpoint, this route is intentionally public
 * — the consumer is the application's own server-side renderer, not a
 * privileged operator.
 *
 * @see {@link ../../../../docs/system/system-hooks.md} for the hook
 *   contract this controller invokes.
 * @module backend/hooks/api/ssr-html-attributes.controller
 */

import type { Request, Response } from 'express';
import type { IHookRegistry, ISsrHeadContext, ISystemLogService } from '@/types';
import { HOOKS } from '../registry.js';

/**
 * Default seed for the html-attributes waterfall. Carries the
 * documented baseline (`lang`) so handlers can choose to override or
 * leave the seed in place.
 */
const SEED_ATTRIBUTES: Readonly<Record<string, string>> = Object.freeze({ lang: 'en' });

/**
 * Coerce an unknown value into a string-keyed string map, dropping any
 * non-string pairs. Identical to the helper in the head-fragments
 * controller — kept module-local because the surface is tiny and
 * shared abstraction would couple two otherwise-independent endpoints.
 *
 * @param raw - Value claimed to be a string-keyed map.
 * @returns Sanitized record (empty when input is not an object).
 */
function sanitizeStringMap(raw: unknown): Record<string, string> {
    if (raw === null || typeof raw !== 'object') return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
        if (typeof k === 'string' && typeof v === 'string') {
            out[k] = v;
        }
    }

    return out;
}

/**
 * Controller for the public SSR html-attributes endpoint.
 */
export class SsrHtmlAttributesController {
    /**
     * Construct a controller bound to a hook registry.
     *
     * @param registry - Process-wide hook registry.
     * @param logger - System logger for request-time diagnostics.
     */
    constructor(
        private readonly registry: IHookRegistry,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Handle an html-attributes request.
     *
     * @param req - Express request. Body shape: `{ path, cookies?, query? }`.
     * @param res - Express response. Receives `{ attributes }` JSON.
     */
    public getAttributes = async (req: Request, res: Response): Promise<void> => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const path = typeof body.path === 'string' && body.path.length > 0 ? body.path : '/';
        const context: ISsrHeadContext = {
            path,
            cookies: sanitizeStringMap(body.cookies),
            query: sanitizeStringMap(body.query)
        };

        try {
            const attributes = await this.registry.invoke(
                HOOKS.ssr.htmlAttributes,
                context,
                SEED_ATTRIBUTES
            );
            res.json({ attributes: attributes ?? SEED_ATTRIBUTES });
        } catch (err) {
            this.logger.error(
                { err, path: context.path },
                'ssr.htmlAttributes invocation failed'
            );
            res.status(500).json({ error: 'Html-attributes invocation failed' });
        }

        return;
    };
}
