/**
 * @fileoverview Core (non-plugin) widget component registry.
 *
 * `widgets.generated.ts` is rewritten by the plugin registry generator
 * and only ever holds plugin-exported components, so core-owned widget
 * types need a stable, hand-written home that the generator never
 * clobbers. This module is that home: it maps each core widget type id
 * to its React component, keyed by the exact `typeId` the backend
 * registers (the resolver sets `IWidgetData.id` to the placement's
 * `typeId`, which is what the renderer looks up).
 *
 * The merged lookup in `getWidgetComponent.ts` consults this map before
 * the generated plugin map, so a core type resolves without depending on
 * the generated file's shape.
 *
 * @module frontend/components/widgets/widgets.core
 */

import type { WidgetComponent } from '@/types';
import { RawHtmlWidget } from './RawHtmlWidget';
import { WorldClocksWidget } from './WorldClocksWidget';
import { BlockTickerWidget } from './BlockTickerWidget';
import { NetworkActivityWidget } from './NetworkActivityWidget';

/**
 * Core widget components keyed by backend widget-type id. Mirrors the
 * `CORE_WIDGET_TYPE_DESCRIPTORS` registered in
 * `backend/modules/widgets/widget-types/core-widget-types.ts` — every id
 * registered there must have a matching renderer here.
 */
export const coreWidgetComponents: Record<string, WidgetComponent> = {
    'core:raw-html': RawHtmlWidget,
    'core:world-clocks': WorldClocksWidget,
    'core:block-ticker': BlockTickerWidget,
    'core:network-activity': NetworkActivityWidget
};
