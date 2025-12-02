/**
 * Whale alerts widget components.
 *
 * Widget components for SSR widget zones. The widgetComponents export maps
 * widget IDs (matching backend registration) to React components. This mapping
 * is discovered at build time by the generator script, enabling SSR.
 *
 * After hydration, widget components can subscribe to WebSocket for live updates.
 */

import type { ComponentType } from 'react';
import { RecentWhalesWidget } from './RecentWhalesWidget';

/**
 * Widget component registry for this plugin.
 *
 * Keys must match the widget IDs used in backend registration.
 * This export is discovered by the build-time generator script.
 */
export const widgetComponents: Record<string, ComponentType<{ data: unknown }>> = {
    'whale-alerts:recent': RecentWhalesWidget
};
