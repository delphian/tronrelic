/**
 * Plugin system type definitions.
 *
 * Exports all plugin-related interfaces and utilities for the TronRelic plugin architecture.
 * These types enable type-safe plugin development across both backend and frontend runtimes.
 */
export type { IPlugin } from './IPlugin.js';
export type { IPluginManifest } from './IPluginManifest.js';
export type { IAdminUIConfig } from './IAdminUIConfig.js';
export type { IMenuItemConfig } from './IMenuItemConfig.js';
export type { IPageConfig } from './IPageConfig.js';
export type { IPluginDatabase } from './IPluginDatabase.js';
export type { IApiRouteConfig, HttpMethod, ApiRouteHandler, ApiMiddleware } from './IApiRouteConfig.js';
export type {
    IPluginMetadata,
    IPluginManagementRequest,
    IPluginManagementResponse,
    IPluginInfo
} from './IPluginMetadata.js';
export type {
    IFrontendPluginContext,
    IUIComponents,
    IChartComponents,
    IApiClient,
    IWebSocketClient
} from './IFrontendPluginContext.js';
export { definePlugin } from './definePlugin.js';
