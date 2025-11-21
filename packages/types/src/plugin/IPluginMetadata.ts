/**
 * Plugin metadata stored in the database.
 *
 * Tracks the installation and enabled state of plugins in the system.
 * Plugins are auto-discovered on startup and registered with default
 * states of installed: false and enabled: false. Only plugins that are
 * both installed and enabled will have their backend and frontend
 * components loaded and initialized.
 */
export interface IPluginMetadata {
    /** Unique plugin identifier matching the manifest id */
    id: string;

    /** Plugin display title */
    title: string;

    /** Semantic version string */
    version: string;

    /** Whether the plugin has been installed (install hook has run successfully) */
    installed: boolean;

    /** Whether the plugin is currently enabled and active */
    enabled: boolean;

    /** Timestamp when the plugin was first discovered */
    discoveredAt: Date;

    /** Timestamp when the plugin was installed (null if never installed) */
    installedAt: Date | null;

    /** Timestamp when the plugin was last enabled (null if never enabled) */
    enabledAt: Date | null;

    /** Timestamp when the plugin was last disabled (null if never disabled) */
    disabledAt: Date | null;

    /** Timestamp when the plugin was last uninstalled (null if never uninstalled) */
    uninstalledAt: Date | null;

    /** Last error message encountered during lifecycle hooks (null if no errors) */
    lastError: string | null;

    /** Timestamp of last error (null if no errors) */
    lastErrorAt: Date | null;
}

/**
 * Request payload for plugin management operations.
 */
export interface IPluginManagementRequest {
    /** Plugin ID to perform operation on */
    pluginId: string;
}

/**
 * Response from plugin management operations.
 */
export interface IPluginManagementResponse {
    /** Whether the operation succeeded */
    success: boolean;

    /** Human-readable message describing the result */
    message: string;

    /** Updated plugin metadata after the operation */
    metadata?: IPluginMetadata;

    /** Error message if operation failed */
    error?: string;
}

/**
 * Extended plugin information combining manifest and metadata.
 */
export interface IPluginInfo {
    /** Plugin manifest from the code */
    manifest: {
        id: string;
        title: string;
        version: string;
        description?: string;
        author?: string;
        license?: string;
        backend?: boolean;
        frontend?: boolean;
        adminUrl?: string;
    };

    /** Plugin state from database */
    metadata: IPluginMetadata;
}
