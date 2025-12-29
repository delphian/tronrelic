/**
 * Widget system type definitions.
 *
 * Provides interfaces for plugin widget registration and SSR data fetching.
 * Widgets allow plugins to inject UI components into designated zones on existing
 * pages without modifying core page code.
 */

export { WIDGET_ZONES } from './IWidgetConfig.js';
export type { IWidgetConfig, WidgetZone } from './IWidgetConfig.js';
export type { IWidgetData } from './IWidgetData.js';
export type { IWidgetService } from './IWidgetService.js';
export type { IWidgetComponentProps, WidgetComponent } from './IWidgetComponentProps.js';
