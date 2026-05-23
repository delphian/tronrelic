/**
 * @fileoverview Widget-type subsystem barrel — internal to the widgets module.
 *
 * Exports the `defineWidgetType` descriptor mint and the
 * `WidgetTypeRegistry` runtime class. Consumers outside the widgets
 * module reach widget types through `IWidgetsService` on the service
 * registry, not these symbols.
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
