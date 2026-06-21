/**
 * @fileoverview Service-layer error classes for the widgets module.
 *
 * HTTP adapters in `api/placements.controller.ts` discriminate on these
 * classes via `instanceof` rather than matching against
 * `err.message` prefixes — the message text remains free to evolve
 * without silently degrading 400/409 responses to 500. Mirrors the
 * convention in `modules/identity/services/user-group.errors.ts`.
 *
 * @module backend/modules/widgets/widgets.errors
 */

/**
 * Base class for widget-service errors so callers that only care that
 * "this came from the widgets service" can narrow with a single check.
 */
export class WidgetsServiceError extends Error {
    constructor(message: string) {
        super(message);
        this.name = this.constructor.name;
    }
}

/**
 * Thrown when a placement targets a widget type id that is not present
 * in the type registry.
 */
export class UnknownWidgetTypeError extends WidgetsServiceError {
    constructor(public readonly typeId: string) {
        super(`Unknown widget type '${typeId}'`);
    }
}

/**
 * Thrown when a placement targets a zone id that is not present in the
 * zone registry.
 */
export class UnknownZoneError extends WidgetsServiceError {
    constructor(public readonly zoneId: string) {
        super(`Unknown zone '${zoneId}'`);
    }
}

/**
 * Thrown when `registerWidget` is called with a typeId already owned by
 * a different plugin. Surfaces a 4xx-class condition rather than a
 * silent cross-plugin collision.
 */
export class WidgetTypeOwnerConflictError extends WidgetsServiceError {
    constructor(
        public readonly typeId: string,
        public readonly existingOwner: string,
        public readonly requestingOwner: string
    ) {
        super(
            `Widget type "${typeId}" is already owned by plugin "${existingOwner}"; ` +
                `plugin "${requestingOwner}" cannot register a placement against it.`
        );
    }
}

/**
 * Thrown when a placement's `parentId` does not name a valid layout-group
 * container. Covers every way the one-level nesting contract can be
 * broken: the parent row does not exist, the parent is not a
 * `core:layout-group`, the parent is itself nested (which would make the
 * tree two levels deep), or the placement being nested is itself a layout
 * group. HTTP maps this to 400.
 */
export class InvalidParentPlacementError extends WidgetsServiceError {
    constructor(message: string) {
        super(message);
    }
}

/**
 * Thrown when the controller attempts to DELETE a plugin-source
 * placement. The supported reversals are disable and restore-defaults;
 * deletion would silently re-appear on the next plugin enable.
 */
export class PluginPlacementDeletionForbiddenError extends WidgetsServiceError {
    constructor() {
        super(
            'Plugin-source placements cannot be deleted. Disable the plugin or update the placement to enabled: false instead.'
        );
    }
}

/**
 * Thrown when `restorePluginDefaults` is invoked on an operator-source
 * placement. There is no plugin-defined default to restore.
 */
export class RestoreDefaultsOnOperatorRowError extends WidgetsServiceError {
    constructor() {
        super('restorePluginDefaults is only valid on plugin-source placements');
    }
}

/**
 * Thrown when `restorePluginDefaults` cannot find cached registration
 * args for a plugin-source placement. Indicates the plugin has not
 * registered in this process (e.g. disabled before the cache was
 * populated). HTTP maps this to 409 — re-enable the plugin to
 * repopulate the cache and retry.
 */
export class MissingPluginDefaultsError extends WidgetsServiceError {
    constructor(
        public readonly pluginId: string,
        public readonly typeId: string
    ) {
        super(
            `No cached plugin defaults for '${pluginId}::${typeId}'. ` +
                `Re-enable the plugin in this process to repopulate the cache.`
        );
    }
}
