/**
 * @fileoverview Typed descriptor for a declared widget zone.
 *
 * A zone is a physical injection point in the rendered UI — somewhere in
 * the markup a layout calls `<WidgetZone descriptor={...} />` and the
 * runtime pulls in every placement targeting that zone. Zone descriptors
 * are the single source of truth for what zones exist; the runtime
 * placement service refuses to accept a placement whose zone id is not
 * in the descriptor registry.
 *
 * Descriptors are minted by `defineZone(...)`, which tracks them in a
 * module-local set so the runtime registry can refuse forged descriptors.
 * Plugins do not import `defineZone` directly — they call
 * `context.zones.register(options)` and the facade constructs the
 * descriptor internally tagged with the plugin id. Core declarations
 * live in a central `ZONES` object so layouts can reference them by
 * typed identifier instead of string.
 *
 * @module types/widget-zones/IZoneDescriptor
 */

/**
 * The layout context a zone is rendered inside. Drives admin-UI grouping
 * and operator expectations about which pages the zone reaches; the
 * actual rendering site is still owned by whichever layout calls
 * `<WidgetZone>`, so this is metadata, not enforcement.
 *
 * - `'site'`: rendered by the root layout — reaches every route the root
 *   layout serves.
 * - `'core'`: rendered by the `(core)` route-group layout — front-of-house
 *   pages only.
 * - `'plugin'`: rendered inside a plugin page wrapper.
 * - `'admin'`: rendered on admin / system pages. Reserved for future use.
 */
export type ZoneHost = 'site' | 'core' | 'plugin' | 'admin';

/**
 * Visual layout hint for the admin placement editor and the renderer.
 *
 * - `'vertical'`: widgets stack top-to-bottom (default for content zones).
 * - `'horizontal'`: widgets sit side-by-side (used for sidebars and
 *   navigation accessories).
 * - `'grid'`: widgets flow into a responsive grid (dashboard zones).
 */
export type ZoneLayout = 'vertical' | 'horizontal' | 'grid';

/**
 * Immutable descriptor for a single zone. Returned by `defineZone` and
 * stored in the runtime registry. Layouts reference the descriptor's
 * `id` when calling `<WidgetZone>`; admin tools render `label` and
 * `description` directly.
 *
 * The descriptor is frozen on construction. Mutating it raises a runtime
 * error and breaks the identity check the registry performs at
 * registration time.
 */
export interface IZoneDescriptor {
    /** Dotted, fully qualified id — e.g. `main-after`, `whale-detail:sidebar`. */
    readonly id: string;
    /** Short label rendered in admin UIs (zone palette, placement editor). */
    readonly label: string;
    /** Sentence-length description shown on hover and in the admin timeline. */
    readonly description: string;
    /** Layout context the zone is rendered inside. */
    readonly host: ZoneHost;
    /** Visual layout hint. */
    readonly layout: ZoneLayout;
    /**
     * Display order of this zone within its host track in admin tooling
     * (the `/system/widgets` placement editor). Lower sorts first, so a
     * zone authored to sit at the bottom of the page — e.g. the site
     * footer — declares a higher value than zones above it. This orders
     * the *zones* in the editor, not the placements within a zone (that
     * is the placement's own `order`). Optional: zones omitting it sort
     * after all explicitly-ordered zones, by id.
     */
    readonly order?: number;
}

/**
 * Initialisation options accepted by `defineZone`.
 *
 * Plugins pass the same shape to `context.zones.register(...)` — the
 * facade constructs the descriptor on their behalf so plugin code never
 * imports `defineZone` directly.
 */
export interface IDefineZoneOptions {
    /** Dotted, fully qualified id. Must be unique across the process. */
    id: string;
    /** Short label for admin UIs. */
    label: string;
    /** Sentence-length description. */
    description: string;
    /** Layout context. */
    host: ZoneHost;
    /** Visual layout hint. Defaults to `'vertical'` when omitted. */
    layout?: ZoneLayout;
    /**
     * Display order within the host track in admin tooling. Lower sorts
     * first; omit to sort after explicitly-ordered zones by id. See
     * {@link IZoneDescriptor.order}.
     */
    order?: number;
}

/**
 * Disposer returned from zone registration. Calling it removes the zone
 * from the runtime registry — placements targeting the removed zone
 * resolve to "zone unavailable" and the renderer skips them, but does
 * not crash. Plugin-owned zones are bulk-disposed by the plugin loader
 * on `disable()`; the disposer is exposed for finer-grained control.
 */
export type ZoneRegisterDisposer = () => void;
