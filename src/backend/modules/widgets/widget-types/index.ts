/**
 * @fileoverview Widget-type subsystem barrel.
 *
 * Public exports for the widget-type subsystem — the
 * `defineWidgetType` constructor, the runtime `WidgetTypeRegistry`,
 * and the per-plugin `PluginWidgetTypes` facade. Consumed by
 * `WidgetsModule`, the plugin loader, the placement resolver, and the
 * compat-shim widget service.
 *
 * @module backend/modules/widgets/widget-types
 */

export {
    defineWidgetType,
    forgetWidgetType,
    isKnownWidgetType,
    listKnownWidgetTypes,
    __resetKnownWidgetTypesForTests
} from './define-widget-type.js';
export { WidgetTypeRegistry, RESERVED_PLUGIN_ID } from './widget-type-registry.js';
export { PluginWidgetTypes } from './plugin-widget-types.js';
