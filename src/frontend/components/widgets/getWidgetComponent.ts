/**
 * @fileoverview Merged widget component lookup.
 *
 * The widget renderer must resolve both core-owned components
 * (`widgets.core.ts`, hand-written) and plugin-exported components
 * (`widgets.generated.ts`, rewritten by the registry generator). This
 * module is the single lookup that merges the two, so call sites do not
 * need to know which source owns a given widget type. Core wins on id
 * collision — core ids are namespaced under `core:` and never overlap
 * plugin ids in practice, but the precedence keeps core deterministic.
 *
 * @module frontend/components/widgets/getWidgetComponent
 */

import type { WidgetComponent } from '@/types';
import { coreWidgetComponents } from './widgets.core';
import { widgetComponentRegistry } from './widgets.generated';

/**
 * Resolve the React component for a widget type id.
 *
 * Checks the core registry first, then the generated plugin registry,
 * so core types render without relying on the generated file's contents.
 *
 * @param widgetId - Widget-type id (`IWidgetData.id`, i.e. the
 *   placement's `typeId`).
 * @returns The matching component, or `undefined` when none is
 *   registered (dev shows a debug fallback; production renders nothing).
 */
export function getWidgetComponent(widgetId: string): WidgetComponent | undefined {
    return coreWidgetComponents[widgetId] ?? widgetComponentRegistry[widgetId];
}
