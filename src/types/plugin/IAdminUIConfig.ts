import type { ComponentType } from 'react';

/**
 * Admin UI configuration for plugin dashboard pages.
 *
 * Defines admin dashboard pages provided by a plugin. Each plugin can register
 * one or more admin pages that appear in the system administration interface,
 * complete with routing, icons, and optional categorization for menu organization.
 */
export interface IAdminUIConfig {
    /** URL path (must start with /admin/) */
    path: string;
    /** Icon name from Lucide React */
    icon: string;
    /** Optional category for grouping in menu */
    category?: string;
    /** React component to render */
    component: ComponentType<any>;
}
