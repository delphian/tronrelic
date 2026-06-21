import type { ComponentType, CSSProperties } from 'react';
import Link from 'next/link';
import type { IZoneLayoutConfig, ZoneGapSize } from '@/types';
import type { WidgetData } from './types';
import { getWidgetComponent } from './getWidgetComponent';
import { WidgetWithContext } from './WidgetWithContext';
import { cn } from '../../lib/cn';
import styles from './WidgetZone.module.scss';

/**
 * Default flexbox layout when a zone carries no resolved config (e.g. the
 * SSR fetch failed and the zones map is empty). Reproduces the historical
 * stacked column so an unconfigured zone looks exactly as it did before
 * zones became flex containers.
 */
const DEFAULT_LAYOUT: IZoneLayoutConfig = {
    flexDirection: 'column',
    justifyContent: 'flex-start',
    alignItems: 'stretch',
    flexWrap: 'nowrap',
    gap: 'md'
};

/**
 * Widget-type id of the structural layout-group container. Mirrors the
 * backend `LAYOUT_GROUP_TYPE_ID`. A widget with this id has no React
 * component in the registry; the renderer special-cases it, drawing its
 * `children` inside a nested flex container instead of looking up a
 * component. Keeping the literal here avoids a frontend import of backend
 * module code.
 */
const LAYOUT_GROUP_TYPE_ID = 'core:layout-group';

/**
 * Map a token gap size to the CSS value the container's `gap` resolves
 * to. Sizes map to the `--gap-*` design tokens (never a raw length) so
 * zone spacing stays on the token scale; `none` is a literal `0`.
 *
 * @param gap - The zone's configured gap size.
 * @returns A CSS length string referencing a gap token, or `0`.
 */
function gapToCss(gap: ZoneGapSize): string {
    switch (gap) {
        case 'none':
            return '0';
        case 'sm':
            return 'var(--gap-sm)';
        case 'lg':
            return 'var(--gap-lg)';
        case 'md':
        default:
            return 'var(--gap-md)';
    }
}

/**
 * Build the inline custom-property style that drives the flex container.
 *
 * The flex values are operator-chosen, so they cannot live in the static
 * stylesheet; they ride as CSS custom properties the colocated module
 * reads with token-backed fallbacks. Keeping them as variables (rather
 * than direct inline `flex-*` props) lets the `.zone` rule own the
 * cascade and the `.item` rule react to wrap state.
 *
 * @param layout - The zone's effective layout config.
 * @returns A style object of `--zone-*` custom properties.
 */
function zoneStyle(layout: IZoneLayoutConfig): CSSProperties {
    return {
        '--zone-flex-direction': layout.flexDirection,
        '--zone-justify-content': layout.justifyContent,
        '--zone-align-items': layout.alignItems,
        '--zone-flex-wrap': layout.flexWrap,
        '--zone-gap': gapToCss(layout.gap)
    } as CSSProperties;
}

/**
 * Map a layout's `collapseBelow` breakpoint to the modifier class that
 * arms the matching `@container` rule on the flex container.
 *
 * A flex container cannot query its own width, so the wrapper element
 * (`.zone_container` / `.group_container`) carries `container-type` and
 * the inner flex container takes one of these classes; the colocated SCSS
 * pairs each class with a `@container` block that flips the inner
 * container to a column below the named breakpoint. Returning `undefined`
 * for `'never'` (or an absent/unknown value) means no class is applied and
 * the row never collapses — the historical behaviour preserved for layouts
 * saved before the field existed.
 *
 * @param collapseBelow - The layout's chosen collapse breakpoint.
 * @returns The modifier class name, or `undefined` to never collapse.
 */
function collapseClassFor(collapseBelow: IZoneLayoutConfig['collapseBelow']): string | undefined {
    switch (collapseBelow) {
        case 'mobile-sm':
            return styles.collapse_mobile_sm;
        case 'mobile-md':
            return styles.collapse_mobile_md;
        case 'mobile-lg':
            return styles.collapse_mobile_lg;
        case 'tablet':
            return styles.collapse_tablet;
        case 'desktop':
            return styles.collapse_desktop;
        case 'never':
        default:
            return undefined;
    }
}

/**
 * Build the inline style that sets a flex item's relative row width.
 *
 * The width rides as the `--item-grow` custom property (consumed by the
 * `.item_weighted` rule as a `flex-grow` weight against a zero basis)
 * rather than an inline `flex`/`flex-basis` declaration. That distinction
 * is load-bearing: the collapse `@container` rule resets weighted children
 * to full width through a class selector, and an inline `flex` shorthand
 * would outrank it and defeat the collapse. Returns `undefined` when the
 * item carries no weight so an unweighted item stays exactly as before.
 *
 * @param layoutWeight - The placement's relative weight, if any.
 * @returns A style object setting `--item-grow`, or `undefined`.
 */
function itemWeightStyle(layoutWeight: number | undefined): CSSProperties | undefined {
    if (typeof layoutWeight !== 'number') {
        return undefined;
    }
    return { '--item-grow': layoutWeight } as CSSProperties;
}

/**
 * Props for WidgetRenderer component.
 */
interface WidgetRendererProps {
    /** Widget data including SSR-fetched content */
    widget: WidgetData;
    /** Current URL path where the widget is rendering */
    route: string;
    /** Route parameters extracted from the URL path */
    params: Record<string, string>;
}

/**
 * Render a single widget with its registered component or fallback.
 *
 * Looks up the component from the statically-generated widget registry.
 * If a component is registered, renders it with the SSR data and plugin context.
 * In development, shows a debug view for unregistered widgets.
 * In production, unregistered widgets render nothing.
 */
function WidgetRenderer({ widget, route, params }: WidgetRendererProps) {
    const Component = getWidgetComponent(widget.id);

    if (Component) {
        return (
            <WidgetWithContext
                Component={Component}
                data={widget.data}
                instanceConfig={widget.instanceConfig}
                pluginId={widget.pluginId}
                route={route}
                params={params}
            />
        );
    }

    // Development fallback: show debug info for unregistered widgets
    if (process.env.NODE_ENV === 'development') {
        return (
            <div className="surface surface--padding-md border border-dashed border-border">
                <p className="text-sm text-muted mb-2">
                    Widget: <code>{widget.id}</code> (no component registered)
                </p>
                <p className="text-xs text-muted mb-2">
                    Export this widget from <code>src/frontend/widgets/index.ts</code>
                </p>
                <pre className="text-xs overflow-auto max-h-48 bg-surface-elevated p-2 rounded">
                    {JSON.stringify(widget.data, null, 2)}
                </pre>
            </div>
        );
    }

    // Production: render nothing for unregistered widgets
    return null;
}

/**
 * Render a layout-group container: a nested flex box whose arrangement
 * comes from the group's own resolved layout, holding the widgets an
 * operator dropped into it.
 *
 * A layout group is structural, not a widget component — it has no entry
 * in the component registry. Its flex config rides in `widget.data` (the
 * backend echoes the group's `instanceConfig` as an `IZoneLayoutConfig`),
 * and its `children` are the nested placements the resolver attached.
 * Renders nothing when the group is empty so a stray container never
 * leaves an empty box on the page.
 *
 * @param widget - The layout-group widget carrying `data` (its layout)
 *   and `children` (the nested widgets).
 * @param route - Current URL path, forwarded to each child.
 * @param params - Route params, forwarded to each child.
 */
function LayoutGroupContainer({ widget, route, params }: WidgetRendererProps) {
    const children = widget.children ?? [];
    if (children.length === 0) {
        return null;
    }

    const layout = (widget.data as IZoneLayoutConfig | null) ?? DEFAULT_LAYOUT;

    // Outer wrapper carries the container-query context so the inner flex
    // container can collapse based on its OWN width (an element cannot
    // query itself). The inner `.group` keeps the flex styling and the
    // `data-widget-group` hook exactly as before.
    return (
        <div className={styles.group_container}>
            <div
                className={cn(styles.group, collapseClassFor(layout.collapseBelow))}
                style={zoneStyle(layout)}
                data-widget-group={widget.id}
            >
                {children.map(child => (
                    <WidgetItem key={child.id} widget={child} route={route} params={params} />
                ))}
            </div>
        </div>
    );
}

/**
 * Render one placed widget as a flex item: an optional operator heading
 * (optionally linked) above the widget body. The body is either the
 * nested layout-group container (when the item is a `core:layout-group`)
 * or the widget's registered component via `WidgetRenderer`.
 *
 * Shared by the zone's top-level items and a layout group's children so
 * both levels render identically — heading, min-width shrink, and data
 * attributes stay in one place.
 *
 * @param widget - The widget data to render as an item.
 * @param route - Current URL path passed through to the renderer.
 * @param params - Route params passed through to the renderer.
 */
function WidgetItem({ widget, route, params }: WidgetRendererProps) {
    // An empty layout group renders nothing (its container returns null),
    // so skip the wrapper and title entirely — otherwise the operator
    // heading and the flex-gap slot of an empty item leave a stray
    // artifact in the zone.
    const isEmptyLayoutGroup =
        widget.id === LAYOUT_GROUP_TYPE_ID && (widget.children?.length ?? 0) === 0;
    if (isEmptyLayoutGroup) {
        return null;
    }

    // A weighted item gets the `.item_weighted` class plus the `--item-grow`
    // custom property the class consumes; an unweighted item renders exactly
    // as before (auto width, no inline style).
    const weightStyle = itemWeightStyle(widget.layoutWeight);

    return (
        <div
            className={cn(styles.item, weightStyle && styles.item_weighted)}
            style={weightStyle}
            data-widget-id={widget.id}
            data-plugin-id={widget.pluginId}
        >
            {widget.title && (
                <h2 className={styles.item_title}>
                    {widget.titleUrl ? (
                        <Link href={widget.titleUrl}>{widget.title}</Link>
                    ) : (
                        widget.title
                    )}
                </h2>
            )}
            {widget.id === LAYOUT_GROUP_TYPE_ID ? (
                <LayoutGroupContainer widget={widget} route={route} params={params} />
            ) : (
                <WidgetRenderer widget={widget} route={route} params={params} />
            )}
        </div>
    );
}

/**
 * Widget zone component for rendering plugin widgets with SSR support.
 *
 * This is a server component that renders plugin widgets during SSR.
 * Widget components are statically imported at build time via the generated
 * registry, enabling full server-side rendering without loading flash.
 *
 * After hydration, individual widget components can subscribe to WebSocket
 * events for live data updates while maintaining the SSR-rendered initial state.
 *
 * SSR Flow:
 * 1. Build time: Generator creates static imports in widgets.generated.ts
 * 2. Request time: Layout fetches widget data from backend API
 * 3. SSR: WidgetZone renders components with fresh data
 * 4. Hydration: Widget components become interactive, can subscribe to WebSocket
 *
 * The zone renders as a CSS flex container; each placed widget is a flex
 * item. The arrangement (direction, alignment, wrap, gap) comes from the
 * operator-configured `layout` — resolved server-side and passed in — so
 * the same zone can stack widgets, lay them in a centered row, or wrap
 * them into a grid without code changes. Falls back to a stacked column
 * when `layout` is omitted.
 *
 * @param name - Zone identifier (e.g., 'main-after', 'sidebar-top')
 * @param widgets - Array of widget data from SSR fetch
 * @param route - Current URL path for context-aware widgets
 * @param params - Route parameters extracted from the URL path
 * @param layout - Effective flexbox layout for this zone (from the SSR bundle)
 *
 * @example
 * ```tsx
 * // In layout.tsx (Server Component)
 * const { widgets, zones } = await fetchWidgetsForRoute(pathname, params);
 *
 * <WidgetZone name="main-after" widgets={widgets} layout={zones['main-after']} route={pathname} params={params} />
 * ```
 */
export function WidgetZone({
    name,
    widgets,
    route,
    params,
    layout
}: {
    name: string;
    widgets: WidgetData[];
    route: string;
    params: Record<string, string>;
    layout?: IZoneLayoutConfig;
}) {
    // Filter widgets for this zone and sort by order
    const zoneWidgets = widgets
        .filter(w => w.zone === name)
        .sort((a, b) => a.order - b.order);

    // Don't render empty zones
    if (zoneWidgets.length === 0) {
        return null;
    }

    const effectiveLayout = layout ?? DEFAULT_LAYOUT;

    // Outer wrapper carries the container-query context so the zone's flex
    // container collapses based on its OWN rendered width (an element cannot
    // query itself). The inner `.zone` keeps the flex styling and the
    // `data-zone` hook unchanged.
    return (
        <div className={styles.zone_container}>
            <div
                className={cn(styles.zone, collapseClassFor(effectiveLayout.collapseBelow))}
                data-zone={name}
                style={zoneStyle(effectiveLayout)}
            >
                {zoneWidgets.map(widget => (
                    <WidgetItem key={widget.id} widget={widget} route={route} params={params} />
                ))}
            </div>
        </div>
    );
}
