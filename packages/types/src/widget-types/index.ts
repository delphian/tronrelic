/**
 * @fileoverview Public type surface for the widget-type system.
 *
 * Plugins register widget types through
 * `IWidgetsService.registerType(...)` (or the convenience
 * `IWidgetsService.registerWidget(...)`) on the `'widgets'` service.
 * The `IWidgetTypeRegistry` interface is internal to the widgets
 * module — the public surface is `IWidgetsService`.
 *
 * @module types/widget-types
 */

export type {
    IWidgetType,
    IWidgetPlacementContext,
    IDefineWidgetTypeOptions,
    WidgetDataFetcher,
    WidgetTypeRegisterDisposer
} from './IWidgetType.js';

export type {
    IWidgetTypeRegistry,
    IWidgetTypeSnapshot,
    IWidgetTypeSnapshotRecord
} from './IWidgetTypeRegistry.js';
