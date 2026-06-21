/**
 * @fileoverview Admin introspection surface for the central content-type
 * registry — the read-only `/system/content-types` view.
 *
 * The content registry centralizes every provider-owned content type so any
 * pipeline (curation, notifications) can render it; this endpoint is the one
 * place an operator sees the aggregate. It is the direct analog of the
 * `/system/hooks` timeline: a thin, cache-free controller that asks a
 * process-wide registry for a snapshot and returns it verbatim.
 *
 * Each row is enriched with the one binding that is *statically* resolvable —
 * whether a curation type backs the id. Notification usage is deliberately not
 * shown: a notification chooses its content type per `notify()` call, so there
 * is no static category→type mapping to attribute, and claiming one would
 * mislead.
 */

import { Router } from 'express';
import type { Request, Response } from 'express';
import type { IContentRegistry, IServiceRegistry, ICurationService } from '@/types';

/** Service-registry key of the curation service whose binding we surface. Resolved lazily by literal key to avoid coupling core to the ai-tools module. */
const CURATION_SERVICE = 'curation';

/**
 * One content type as the admin view presents it: the registry record plus the
 * statically-resolvable curation binding.
 */
export interface IContentTypeAdminView {
    /** Namespaced content type id. */
    typeId: string;
    /** Human-readable label. */
    label: string;
    /** Id of the registering plugin or module. */
    providerId: string;
    /** Whether a curation type is registered for this id (the type is reviewable). */
    curatable: boolean;
}

/**
 * Read-only controller backing `/api/admin/system/content-types`. Intentionally
 * thin: no caching (registrations change at runtime as plugins enable/disable)
 * and no transformation beyond the curation-binding join.
 */
export class ContentTypesController {
    /**
     * @param content - The central content-type registry, the snapshot source.
     * @param services - Service registry, used to resolve the curation service
     *   lazily per request so the binding reflects the live enable-state of the
     *   owning plugin rather than a boot-time snapshot.
     */
    constructor(
        private readonly content: IContentRegistry,
        private readonly services: IServiceRegistry
    ) {}

    /**
     * Return every registered content type, each tagged with whether a curation
     * type currently backs it.
     *
     * @param _req - Unused.
     * @param res - Express response; receives `{ types: IContentTypeAdminView[] }`.
     */
    public getSnapshot = (_req: Request, res: Response): void => {
        const curation = this.services.get<ICurationService>(CURATION_SERVICE);
        const types: IContentTypeAdminView[] = this.content.list().map((entry) => ({
            typeId: entry.typeId,
            label: entry.label,
            providerId: entry.providerId,
            curatable: curation?.hasType(entry.typeId) ?? false
        }));
        res.json({ types });

        return;
    };
}

/**
 * Build the admin router for the content-type introspection surface. Admin
 * authentication is applied at mount time by the caller, mirroring the hooks
 * router, so the factory stays usable from tests without the auth middleware.
 *
 * @param controller - Controller bound to the content registry.
 * @returns Express router with a single GET endpoint.
 */
export function createContentTypesAdminRouter(controller: ContentTypesController): Router {
    const router = Router();
    router.get('/', controller.getSnapshot);

    return router;
}
