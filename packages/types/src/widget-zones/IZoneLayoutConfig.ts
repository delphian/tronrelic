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
}
