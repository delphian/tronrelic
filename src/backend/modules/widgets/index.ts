/**
 * @fileoverview Widgets module public API.
 *
 * Exposes the module class, its dependency interface, and the unified
 * widgets service. The internal registries, the placement service,
 * the placement resolver, and the descriptor mint functions are not
 * re-exported — consumers reach widget functionality exclusively
 * through `IWidgetsService` on the service registry as `'widgets'`.
 *
 * @module backend/modules/widgets
 */

export { WidgetsModule } from './WidgetsModule.js';
export type { IWidgetsModuleDependencies } from './WidgetsModule.js';
export { WidgetsService } from './widgets.service.js';

// Admin controller and router factories are exported for tests and
// for the module's own bootstrap; production consumers do not import
// these directly.
export { ZonesController } from './api/zones.controller.js';
export { createZonesAdminRouter } from './api/zones.routes.js';
export { PlacementsController } from './api/placements.controller.js';
export { createPlacementsAdminRouter } from './api/placements.routes.js';
export { WidgetTypesController } from './api/widget-types.controller.js';
export { createWidgetTypesAdminRouter } from './api/widget-types.routes.js';

// Storage schema and collection constant remain exported for tests
// and migrations.
export type { IWidgetPlacementDocument } from './database/index.js';
export { WIDGET_PLACEMENT_COLLECTION } from './database/index.js';
