import type { IPluginManifest } from "@tronrelic/types";

/**
 * Example Dashboard plugin manifest.
 *
 * This manifest demonstrates the centralized menu/page system. The plugin provides
 * both a navigation menu item and a routable page, showcasing how plugins can extend
 * the UI without modifying core infrastructure.
 */
export const exampleDashboardManifest: IPluginManifest = {
    id: "example-dashboard",
    title: "Example Dashboard",
    version: "0.1.0",
    description: "Demonstrates the plugin menu and page system with a sample dashboard.",
    author: "TronRelic Team",
    backend: false,
    frontend: true
};
