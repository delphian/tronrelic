/**
 * Menu module public API exports.
 *
 * This module provides centralized control over TronRelic's hierarchical menu
 * system with event-driven validation, real-time WebSocket updates, and
 * in-memory caching for fast tree access.
 *
 * Key exports:
 * - MenuModule: IModule implementation for bootstrap integration
 * - MenuService: Singleton service managing menu state and operations
 * - MenuController: HTTP request handlers for REST API endpoints
 * - Types: Interfaces and type definitions for menu nodes and events
 *
 * Usage:
 * ```typescript
 * import { MenuModule } from './modules/menu/index.js';
 *
 * const menuModule = new MenuModule();
 * await menuModule.init({ database, app });
 * await menuModule.run();
 *
 * const menuService = menuModule.getMenuService();
 * menuService.subscribe('before:create', async (event) => {
 *   // Validate or modify menu operations
 * });
 * ```
 */

export { MenuModule } from './MenuModule.js';
export type { IMenuModuleDependencies } from './MenuModule.js';
export { MenuService } from './menu.service.js';
export { MenuController } from './menu.controller.js';

// Re-export types from @tronrelic/types for convenience
export type {
    IMenuService,
    IMenuNode,
    IMenuTree,
    IMenuNodeWithChildren,
    IMenuEvent,
    IMenuValidation,
    MenuEventType,
    MenuEventSubscriber
} from '@tronrelic/types';
