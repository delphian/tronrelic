/**
 * AUTO-GENERATED FILE. DO NOT EDIT.
 *
 * This module is produced by scripts/generate-frontend-plugin-registry.mjs
 * and provides static imports for widget components enabling SSR.
 *
 * Widget components are statically imported (not lazy-loaded) so they're
 * available during server-side rendering. This enables full widget HTML
 * to be rendered on the server for instant display without loading flash.
 */
import type { WidgetComponent } from '@/types';

import { widgetComponents as dust_tracker_widgets } from '../../../plugins/trp-dust-tracker/src/frontend/widgets/index';
import { widgetComponents as memo_tracker_widgets } from '../../../plugins/trp-memo-tracker/src/frontend/widgets/index';
import { widgetComponents as whale_alerts_widgets } from '../../../plugins/whale-alerts/src/frontend/widgets/index';

/**
 * Combined widget component registry from all plugins.
 *
 * Maps widget IDs to their React components. Widget IDs must match
 * the IDs used in backend widget registration.
 */
export const widgetComponentRegistry: Record<string, WidgetComponent> = {
    ...dust_tracker_widgets,
    ...memo_tracker_widgets,
    ...whale_alerts_widgets,
};

/**
 * Look up a widget component by ID.
 *
 * @param widgetId - Widget identifier (e.g., 'whale-alerts:recent')
 * @returns Component if registered, undefined otherwise
 */
export function getWidgetComponent(widgetId: string): WidgetComponent | undefined {
    return widgetComponentRegistry[widgetId];
}
