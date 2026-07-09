/**
 * @fileoverview Public type surface for widget placement persistence.
 *
 * Re-exports the placement record, input shapes, and service contract
 * so consumers can import them from a single barrel.
 *
 * @module types/widget-placements
 */

export type {
    IWidgetPlacement,
    IPlacementInput,
    IPluginPlacementInput,
    PlacementSource,
    WidgetTitleSize
} from './IWidgetPlacement.js';

export type {
    IPlacementService,
    IPlacementListFilter,
    IPlacementPatch
} from './IPlacementService.js';
