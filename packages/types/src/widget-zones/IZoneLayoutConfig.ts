/**
 * @fileoverview Operator-configurable flexbox layout for a widget zone.
 *
 * A zone renders its placed widgets as a CSS flex container; this config
 * is the operator's choice of how that container arranges its items. It
 * is distinct from {@link IZoneDescriptor.layout} — the coarse,
 * code-declared `'vertical' | 'horizontal' | 'grid'` hint — which seeds
 * the *default* when no operator override exists. The override is
 * persisted per zone id and applied at SSR by the `WidgetZone` renderer.
 *
 * The shape mirrors the flexbox properties an operator actually tunes
 * (direction, main- and cross-axis alignment, wrapping, gap) rather than
 * exposing raw CSS, so the admin UI can offer a preset dropdown plus
 * granular selects and the renderer can map each value to a design-token
 * gap without parsing arbitrary CSS.
 *
 * @module types/widget-zones/IZoneLayoutConfig
 */

/** `flex-direction` — main-axis orientation of the zone's items. */
export type ZoneFlexDirection = 'row' | 'row-reverse' | 'column' | 'column-reverse';

/** `justify-content` — distribution of items along the main axis. */
export type ZoneJustifyContent =
    | 'flex-start'
    | 'center'
    | 'flex-end'
    | 'space-between'
    | 'space-around'
    | 'space-evenly';

/** `align-items` — alignment of items along the cross axis. */
export type ZoneAlignItems = 'stretch' | 'flex-start' | 'center' | 'flex-end' | 'baseline';

/** `flex-wrap` — whether items wrap onto multiple lines. */
export type ZoneFlexWrap = 'nowrap' | 'wrap';

/**
 * Gap between items, expressed as a design-token t-shirt size rather than
 * a raw length so the renderer maps it to `--gap-*` (and `none` to `0`),
 * keeping zone spacing on the token scale.
 */
export type ZoneGapSize = 'none' | 'sm' | 'md' | 'lg';

/**
 * Width threshold at which a row layout collapses to a single stacked
 * column.
 *
 * Side-by-side widgets work on a wide host but crush on a narrow one, so
 * an operator picks the container width below which the flex container
 * flips to a column and each weighted child takes the full width. The
 * values name the platform breakpoints (`mobile-sm` 360px … `desktop`
 * 1200px) so the renderer can map each to a `@container` query against a
 * `_breakpoints` variable rather than a hand-typed pixel value; `'never'`
 * (the default when the field is unset) keeps the row at every width,
 * preserving the historical behaviour for layouts created before this
 * field existed.
 *
 * The threshold is measured against the *container's own* width — the
 * zone or layout group — not the viewport, so a group nested in a narrow
 * sidebar collapses independently of one spanning the full page.
 */
export type ZoneCollapseBreakpoint =
    | 'never'
    | 'mobile-sm'
    | 'mobile-md'
    | 'mobile-lg'
    | 'tablet'
    | 'desktop';

/**
 * Named popular layout the admin UI offers as a one-click preset. Each
 * preset sets the four flex properties; `'custom'` marks a config the
 * operator hand-tuned past any preset so the UI shows the granular
 * controls as the source of truth.
 */
export type ZoneLayoutPreset =
    | 'row-left'
    | 'row-center'
    | 'row-between'
    | 'row-right'
    | 'row-wrap'
    | 'column'
    | 'custom';

/**
 * Effective flexbox layout for a zone container. The `WidgetZone`
 * renderer reads these to set the container's flex properties (gap via a
 * token), and the admin editor reads/writes them through the zone-layout
 * admin endpoint. `preset` is UI sugar — the renderer ignores it and
 * applies only the explicit flex fields.
 */
export interface IZoneLayoutConfig {
    /** Preset the operator last selected, or `'custom'` when hand-tuned. */
    preset?: ZoneLayoutPreset;
    /** Main-axis orientation. */
    flexDirection: ZoneFlexDirection;
    /** Main-axis distribution. */
    justifyContent: ZoneJustifyContent;
    /** Cross-axis alignment. */
    alignItems: ZoneAlignItems;
    /** Whether items wrap onto multiple lines. */
    flexWrap: ZoneFlexWrap;
    /** Inter-item gap as a token size. */
    gap: ZoneGapSize;
    /**
     * Container width below which the layout collapses to a single
     * stacked column (and weighted children reset to full width). Optional
     * — absent or `'never'` means the row never collapses, the behaviour
     * for every layout created before this field existed. See
     * {@link ZoneCollapseBreakpoint}.
     */
    collapseBelow?: ZoneCollapseBreakpoint;
    /**
     * Operator-authored CSS declarations (not a full stylesheet — no
     * selectors) applied directly to the zone's flex container, e.g.
     * `background: var(--color-surface); border-bottom: var(--border-width-thin) solid var(--color-border);`.
     * The `WidgetZone` renderer wraps this as `[data-zone="<id>"] { <css> }`
     * in a scoped `<style>` tag at SSR, mirroring how theme CSS is
     * injected. Validated for syntax (not semantics) server-side before
     * persisting. Optional; absent means no override.
     */
    customCss?: string;
}
