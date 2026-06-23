/**
 * @fileoverview Admin introspection surface for the content router — the
 * read-only `/system/content-router` view.
 *
 * The router centralizes every capability-registered sink so any pipeline can
 * compute a content type's destinations; this endpoint is the one place an
 * operator sees the aggregate. It is the direct analog of `/system/content-types`
 * and `/system/hooks`: a thin, cache-free controller that asks a process-wide
 * registry for a snapshot and returns it verbatim.
 *
 * Beyond listing sinks with their `accepts`/`reach`, the endpoint computes, for
 * an operator-supplied classification, which sinks the gate admits and — when
 * descriptor features are also supplied — which of those structurally match.
 * That makes the gate's containment rule and the structural Recipient List
 * inspectable without writing code or firing real content.
 *
 * @module backend/services/content-router-admin
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import {
    CONTENT_EGRESS_LEVELS,
    CONTENT_AUDIENCE_LEVELS,
    CONTENT_DESCRIPTOR_FEATURES
} from '@/types';
import type {
    IContentRouter,
    IContentClassification,
    ContentEgress,
    ContentAudience,
    ContentDescriptorFeature
} from '@/types';

/**
 * The introspection payload: every registered sink, plus the computed admission
 * and structural-candidate sets when the request supplies a classification (and,
 * for candidates, features). Admitted/candidate sinks are reported as ids the UI
 * cross-references against the `sinks` table rather than duplicating each sink's
 * `accepts`/`reach`.
 */
export interface IContentRouterSnapshot {
    /** Every registered sink with its capability and reach. */
    sinks: ReturnType<IContentRouter['list']>;
    /** The classification the request asked about, echoed back, when supplied. */
    classification?: IContentClassification;
    /** Ids of sinks the gate admits for that classification, when supplied. */
    admitted?: string[];
    /** The descriptor features the request asked about, echoed back, when supplied. */
    features?: ContentDescriptorFeature[];
    /** Ids of admitted sinks that structurally match those features, when supplied. */
    candidates?: string[];
}

/**
 * Read-only controller backing `/api/admin/system/content-router`. Intentionally
 * thin: no caching (registrations change at runtime as plugins enable/disable)
 * and no transformation beyond the gate/structural computation the query asks
 * for.
 */
export class ContentRouterController {
    /**
     * @param router - The content router, the snapshot and computation source.
     */
    constructor(private readonly router: IContentRouter) {}

    /**
     * Return every registered sink, plus the admitted set for an operator-supplied
     * classification and the structural candidates for supplied features.
     *
     * Query params: `egress` and `audience` (both required to compute admission)
     * and optional `features` (comma-separated descriptor features). A malformed
     * classification is a 400 so an operator typo is reported, not silently
     * treated as "no candidates".
     *
     * @param req - Express request; reads `egress`, `audience`, `features` query.
     * @param res - Express response; receives an {@link IContentRouterSnapshot}.
     */
    public getSnapshot = (req: Request, res: Response): void => {
        const snapshot: IContentRouterSnapshot = { sinks: this.router.list() };

        const egress = typeof req.query.egress === 'string' ? req.query.egress : undefined;
        const audience = typeof req.query.audience === 'string' ? req.query.audience : undefined;

        // No classification asked about — return the bare sink list.
        if (egress === undefined && audience === undefined) {
            res.json(snapshot);
            return;
        }

        if (!this.isEgress(egress) || !this.isAudience(audience)) {
            res.status(400).json({
                error:
                    'egress and audience are both required and must be known levels. ' +
                    `egress ∈ ${CONTENT_EGRESS_LEVELS.join('|')}, audience ∈ ${CONTENT_AUDIENCE_LEVELS.join('|')}.`
            });
            return;
        }

        const classification: IContentClassification = { egress, audience };
        const admitted = this.router.admit(classification);
        snapshot.classification = classification;
        snapshot.admitted = admitted.map((sink) => sink.id);

        const features = this.parseFeatures(req.query.features);
        if (features !== undefined) {
            snapshot.features = features;
            snapshot.candidates = this.router.candidates(features, admitted).map((sink) => sink.id);
        }

        res.json(snapshot);

        return;
    };

    /**
     * Narrow an unknown query value to a known egress level.
     *
     * @param value - Candidate egress string.
     * @returns True when the value is a known egress level.
     */
    private isEgress(value: string | undefined): value is ContentEgress {
        return value !== undefined && (CONTENT_EGRESS_LEVELS as ReadonlyArray<string>).includes(value);
    }

    /**
     * Narrow an unknown query value to a known audience level.
     *
     * @param value - Candidate audience string.
     * @returns True when the value is a known audience level.
     */
    private isAudience(value: string | undefined): value is ContentAudience {
        return value !== undefined && (CONTENT_AUDIENCE_LEVELS as ReadonlyArray<string>).includes(value);
    }

    /**
     * Parse the optional `features` query into known descriptor features. Returns
     * undefined when the param is absent (so the caller skips candidate
     * computation) and drops any unknown token rather than erroring — an
     * introspection convenience, not a validated mutation.
     *
     * @param raw - The raw `features` query value.
     * @returns The parsed known features, or undefined when the param is absent.
     */
    private parseFeatures(raw: unknown): ContentDescriptorFeature[] | undefined {
        if (typeof raw !== 'string') {
            return undefined;
        }

        const known = new Set<string>(CONTENT_DESCRIPTOR_FEATURES);
        const parsed = raw
            .split(',')
            .map((token) => token.trim())
            .filter((token): token is ContentDescriptorFeature => known.has(token));

        return parsed;
    }
}

/**
 * Build the admin router for the content-router introspection surface. Admin
 * authentication is applied at mount time by the caller, mirroring the hooks and
 * content-types routers, so the factory stays usable from tests without the auth
 * middleware.
 *
 * @param controller - Controller bound to the content router.
 * @returns Express router with a single GET endpoint.
 */
export function createContentRouterAdminRouter(controller: ContentRouterController): Router {
    const router = Router();
    router.get('/', controller.getSnapshot);

    return router;
}
