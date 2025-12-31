import type { ComponentType } from 'react';
import type { IFrontendPluginContext } from '../plugin/IFrontendPluginContext.js';

/**
 * Props interface for widget components.
 *
 * Widget components receive SSR-fetched data, route context, and the frontend
 * plugin context for accessing UI components, layout primitives, and other
 * shared infrastructure.
 *
 * This interface enables dependency injection for widgets, following the same
 * pattern as plugin pages. Widgets can use `context.layout.Stack` or `context.ui.Card`
 * instead of importing directly from the frontend app.
 *
 * @example
 * ```typescript
 * export function MyWidget({ data, context, route, params }: IWidgetComponentProps) {
 *     const { layout, ui } = context;
 *     const widgetData = data as MyWidgetData;
 *
 *     // Access route params for context-aware rendering
 *     const address = params.address;
 *
 *     return (
 *         <ui.Card>
 *             <layout.Stack gap="sm">
 *                 {widgetData.items.map(item => (
 *                     <div key={item.id}>{item.name}</div>
 *                 ))}
 *             </layout.Stack>
 *         </ui.Card>
 *     );
 * }
 * ```
 */
export interface IWidgetComponentProps {
    /**
     * Pre-fetched widget data from SSR.
     *
     * The structure is defined by the widget's backend `fetchData` function.
     * Widgets should cast this to their specific data type.
     */
    data: unknown;

    /**
     * Frontend plugin context with UI components, layout primitives, and utilities.
     *
     * Provides access to:
     * - `context.ui` - UI components (Card, Badge, Button, etc.)
     * - `context.layout` - Layout components (Page, Stack, Grid, etc.)
     * - `context.charts` - Chart components (LineChart, etc.)
     * - `context.api` - API client for data fetching
     * - `context.websocket` - WebSocket client for real-time updates
     */
    context: IFrontendPluginContext;

    /**
     * Current URL path where the widget is rendering.
     *
     * Enables widgets to adjust rendering based on the current page.
     * For example, '/u/TXyz123...' on a profile page.
     */
    route: string;

    /**
     * Route parameters extracted from the URL path.
     *
     * For dynamic routes like `/u/[address]`, this would contain
     * `{ address: 'TXyz123...' }`. Empty object for static routes.
     */
    params: Record<string, string>;
}

/**
 * Widget component type for plugin widget registries.
 *
 * Use this type when defining widget component registries to ensure
 * components accept both data and context props.
 *
 * @example
 * ```typescript
 * import type { WidgetComponent } from '@tronrelic/types';
 *
 * export const widgetComponents: Record<string, WidgetComponent> = {
 *     'my-plugin:feed': MyFeedWidget,
 *     'my-plugin:stats': MyStatsWidget
 * };
 * ```
 */
export type WidgetComponent = ComponentType<IWidgetComponentProps>;
