/**
 * Widget components for plugin UI injection.
 *
 * Provides components and utilities for rendering plugin widgets in designated
 * zones throughout the application. Widgets allow plugins to extend existing
 * pages without modifying core page code.
 *
 * Widget components are statically imported at build time via the generated
 * registry (widgets.generated.ts), enabling full SSR rendering. After hydration,
 * widget components can subscribe to WebSocket for live data updates.
 */

export { WidgetZone } from './WidgetZone';
export { fetchWidgetsForRoute } from './fetchWidgetsForRoute';
export { getWidgetComponent, widgetComponentRegistry } from './widgets.generated';
export type { WidgetData } from './types';
