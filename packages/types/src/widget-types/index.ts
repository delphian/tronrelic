/**
 * @fileoverview Public type surface for the widget-type system.
 *
 * Re-exports the descriptor, registry, and per-plugin facade types so
 * consumers can import them from a single barrel.
 *
 * @module types/widget-types
 */

export type {
    IWidgetType,
    IDefineWidgetTypeOptions,
    WidgetDataFetcher,
    WidgetTypeRegisterDisposer
} from './IWidgetType.js';

export type {
    IWidgetTypeRegistry,
    IWidgetTypeSnapshot,
    IWidgetTypeSnapshotRecord
} from './IWidgetTypeRegistry.js';

export type { IPluginWidgetTypes } from './IPluginWidgetTypes.js';
