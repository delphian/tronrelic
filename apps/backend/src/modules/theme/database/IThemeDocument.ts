import type { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for theme storage.
 *
 * Themes are CSS override documents that can be dynamically loaded into the
 * application's global styles. Multiple themes can be active simultaneously
 * with dependency ordering to control load sequence.
 */
export interface IThemeDocument {
    /**
     * MongoDB ObjectId (internal database identifier).
     */
    _id: ObjectId;

    /**
     * UUID v4 identifier for theme references and dependencies.
     * This is the stable identifier used in dependency arrays.
     */
    id: string;

    /**
     * Human-readable theme name displayed in admin UI.
     * @example 'Dark Mode', 'High Contrast', 'Halloween'
     */
    name: string;

    /**
     * Lucide React icon name for theme toggle button.
     * @example 'Sparkles', 'Ghost', 'Turkey'
     */
    icon: string;

    /**
     * Raw CSS content to inject into the page.
     * Should primarily override CSS custom properties defined in globals.css.
     * @example '.theme-dark { --color-primary: #3b82f6; }'
     */
    css: string;

    /**
     * Array of theme UUIDs that must load before this theme.
     * Used for dependency resolution and topological sorting.
     * @example ['uuid-of-base-theme', 'uuid-of-color-palette']
     */
    dependencies: string[];

    /**
     * Whether this theme is currently active and should be injected into pages.
     * Multiple themes can be active simultaneously.
     */
    isActive: boolean;

    /**
     * Timestamp of theme creation.
     */
    createdAt: Date;

    /**
     * Timestamp of last theme modification (name, css, dependencies, or isActive change).
     */
    updatedAt: Date;
}

/**
 * Input data for creating a new theme.
 * Excludes auto-generated fields (_id, createdAt, updatedAt).
 */
export interface ICreateThemeInput {
    /**
     * Optional client-generated UUID v4.
     * If provided, must be valid UUID v4 format and not already exist.
     * If omitted, server generates a new UUID.
     */
    id?: string;

    /**
     * Human-readable theme name.
     */
    name: string;

    /**
     * Lucide React icon name for theme toggle button.
     */
    icon: string;

    /**
     * Raw CSS content.
     */
    css: string;

    /**
     * Optional array of dependency theme UUIDs.
     * @default []
     */
    dependencies?: string[];

    /**
     * Whether theme should be active immediately.
     * @default false
     */
    isActive?: boolean;
}

/**
 * Input data for updating an existing theme.
 * All fields are optional; only provided fields are updated.
 */
export interface IUpdateThemeInput {
    /**
     * Updated theme name.
     */
    name?: string;

    /**
     * Updated icon name.
     */
    icon?: string;

    /**
     * Updated CSS content.
     */
    css?: string;

    /**
     * Updated dependency array.
     */
    dependencies?: string[];

    /**
     * Updated active status.
     */
    isActive?: boolean;
}
