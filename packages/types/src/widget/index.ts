/**
 * Widget system type definitions.
 *
 * Provides interfaces for plugin widget registration and SSR data fetching.
 * Widgets allow plugins to inject UI components into designated zones on existing
 * pages without modifying core page code.
 */

export { IWidgetConfig, WIDGET_ZONES, type WidgetZone } from './IWidgetConfig.js';
export { IWidgetData } from './IWidgetData.js';
export { IWidgetService } from './IWidgetService.js';
