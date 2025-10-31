/**
 * Menu system type definitions.
 *
 * Provides interfaces for the hierarchical menu system used throughout TronRelic.
 * These types enable type-safe menu management across backend services and frontend
 * components with support for unlimited nesting, event-driven validation, and
 * real-time updates.
 */

export type { IMenuNode, IMenuNodeWithChildren } from './IMenuNode.js';
export type { IMenuTree } from './IMenuTree.js';
export type {
    IMenuValidation,
    MenuEventType,
    IMenuEvent,
    MenuEventSubscriber
} from './IMenuEvent.js';
export type { IMenuService } from './IMenuService.js';
export type { IMenuNamespaceConfig } from './IMenuNamespaceConfig.js';
