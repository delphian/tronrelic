import type { ComponentType, CSSProperties } from 'react';
import Link from 'next/link';
import type { IZoneLayoutConfig, ZoneGapSize } from '@/types';
import type { WidgetData } from './types';
import { getWidgetComponent } from './getWidgetComponent';
import { WidgetWithContext } from './WidgetWithContext';
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

    return (
        <div
            className={styles.zone}
            data-zone={name}
            style={zoneStyle(effectiveLayout)}
        >
            {zoneWidgets.map(widget => (
                <div
                    key={widget.id}
                    className={styles.item}
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
                    <WidgetRenderer widget={widget} route={route} params={params} />
                </div>
            ))}
        </div>
    );
}
