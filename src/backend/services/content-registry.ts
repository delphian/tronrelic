/**
 * @fileoverview The central, in-memory registry of content types.
 *
 * One process-lifetime home where any provider publishes an `IContentType` and
 * any pipeline — the curation queue today, notifications next — discovers it by
 * id. Centralizing the registry is what lets a content type be authored once and
 * reused across pipelines instead of each re-modelling content, and it is the
 * single place the platform's accountability and record-keeping requirements
 * attach to a content type's existence.
 *
 * It is a peer of `ServiceRegistry` and `HookRegistry`: pure in-memory core
 * infrastructure constructed in bootstrap and published on the service registry
 * as `'content-types'`, not a feature module. Persisted state (curation
 * decisions, audit) lives elsewhere and references content types by `typeId`.
 */

import type {
    IContentRegistry,
    IContentType,
    IContentTypeInfo,
    ContentTypeDisposer,
    ISystemLogService
} from '@/types';

/** Service-registry name the content-type registry is published under. */
export const CONTENT_TYPES_SERVICE = 'content-types';

/** A registered content type paired with the id of the provider that owns it. */
interface IRegisteredContentType {
    type: IContentType;
    providerId: string;
}

/**
 * Holds registered content types keyed by id. Registration is idempotent per id
 * — re-registering replaces the descriptor so a plugin hot-reload does not
 * duplicate — and returns a disposer the caller invokes when its owner is torn
 * down.
 */
export class ContentRegistry implements IContentRegistry {
    private readonly types = new Map<string, IRegisteredContentType>();

    /**
     * @param logger - Scoped logger for registration diagnostics.
     */
    constructor(private readonly logger: ISystemLogService) {}

    /**
     * Register (or replace) a content type, returning a disposer that removes
     * this exact registration.
     *
     * @param type - The content type contract a provider owns.
     * @param providerId - Id of the registering plugin or module.
     * @returns A disposer that removes this registration (a no-op if a later
     *          registration of the same id already replaced it).
     */
    register(type: IContentType, providerId: string): ContentTypeDisposer {
        const entry: IRegisteredContentType = { type, providerId };
        if (this.types.has(type.typeId)) {
            this.logger.warn({ typeId: type.typeId }, 'Content type re-registered; replacing prior descriptor');
        }
        this.types.set(type.typeId, entry);
        this.logger.info({ typeId: type.typeId, providerId }, 'Content type registered');

        return () => {
            // Only remove if this exact registration is still the live one — a
            // later re-registration owns the slot and must not be dropped by an
            // earlier disposer.
            if (this.types.get(type.typeId) === entry) {
                this.types.delete(type.typeId);
                this.logger.info({ typeId: type.typeId }, 'Content type unregistered');
            }
        };
    }

    /**
     * Resolve a registered content type.
     *
     * @param typeId - The namespaced content type id.
     * @returns The type, or undefined when no owner is registered.
     */
    get(typeId: string): IContentType | undefined {
        return this.types.get(typeId)?.type;
    }

    /**
     * Whether a content type is registered right now.
     *
     * @param typeId - The namespaced content type id.
     * @returns True when an owner is registered.
     */
    has(typeId: string): boolean {
        return this.types.has(typeId);
    }

    /**
     * List all registered content types for admin and cross-pipeline
     * introspection without exposing the type's callbacks.
     *
     * @returns One info record per registered content type.
     */
    list(): IContentTypeInfo[] {
        return Array.from(this.types.values()).map((entry) => ({
            typeId: entry.type.typeId,
            label: entry.type.label,
            providerId: entry.providerId
        }));
    }
}
