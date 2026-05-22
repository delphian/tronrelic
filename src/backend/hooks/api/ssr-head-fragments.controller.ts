/**
 * @fileoverview Controller backing the public SSR head-fragments endpoint.
 *
 * Provides the bridge between the Next.js SSR layer and the
 * `HOOKS.ssr.headFragments` waterfall: parses request context from the
 * incoming POST body, invokes the hook with an empty seed, and returns
 * the aggregated fragment list. Themes, analytics beacons, and any
 * other contributor registered against the hook surface here.
 *
 * The endpoint is intentionally public — there is no `requireAdmin`
 * middleware — because the SSR caller is the application's own
 * frontend layer, not a privileged operator. The contract carries no
 * sensitive request shape; cookies are passed through transparently so
 * handlers can branch on them.
 *
 * @module backend/hooks/api/ssr-head-fragments.controller
 */

import type { Request, Response } from 'express';
import type { IHookRegistry, IHeadFragment, ISsrHeadContext, ISystemLogService } from '@/types';
import { HOOKS } from '../registry.js';

/**
 * Minimal record-string sanitizer. Coerces every value to string and
 * filters out non-string keys so the controller never forwards a
 * fundamentally malformed map into the handler chain.
 *
 * @param raw - Unknown value claimed to be a string-keyed map.
 * @returns Sanitized record. Empty when input is not an object.
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
 * Controller for the public SSR head-fragments endpoint.
 */
export class SsrHeadFragmentsController {
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
     * Handle a head-fragments request.
     *
     * Reads `path`, `cookies`, `query` from the request body, invokes
     * the `ssr.headFragments` waterfall with an empty seed, and returns
     * the resulting fragment list as `{ fragments: IHeadFragment[] }`.
     *
     * @param req - Express request. Body shape: `{ path: string,
     *   cookies?: Record<string,string>, query?: Record<string,string> }`.
     * @param res - Express response. Receives JSON.
     */
    public getFragments = async (req: Request, res: Response): Promise<void> => {
        const body = (req.body ?? {}) as Record<string, unknown>;
        const path = typeof body.path === 'string' && body.path.length > 0 ? body.path : '/';
        const context: ISsrHeadContext = {
            path,
            cookies: sanitizeStringMap(body.cookies),
            query: sanitizeStringMap(body.query)
        };

        try {
            const fragments = await this.registry.invoke(
                HOOKS.ssr.headFragments,
                context,
                [] as ReadonlyArray<IHeadFragment>
            );
            res.json({ fragments: fragments ?? [] });
        } catch (err) {
            this.logger.error(
                { err, path: context.path },
                'ssr.headFragments invocation failed'
            );
            res.status(500).json({ error: 'Head-fragments invocation failed' });
        }

        return;
    };
}
