import mongoose, { Schema, type Document } from 'mongoose';
import type { IPluginMetadata } from '@tronrelic/types';

/**
 * Plugin metadata document interface for Mongoose.
 *
 * Extends the core IPluginMetadata interface with Mongoose-specific document properties,
 * enabling type-safe database operations for plugin state management.
 */
export interface IPluginMetadataDocument extends Omit<IPluginMetadata, 'id' | 'discoveredAt' | 'installedAt' | 'enabledAt' | 'disabledAt' | 'uninstalledAt' | 'lastErrorAt'>, Document {
    id: string;
    discoveredAt: Date;
    installedAt: Date | null;
    enabledAt: Date | null;
    disabledAt: Date | null;
    uninstalledAt: Date | null;
    lastErrorAt: Date | null;
}

/**
 * Plugin metadata schema for MongoDB.
 *
 * Stores plugin installation and enabled state so the system can dynamically
 * control which plugins are active. Plugins are auto-discovered and registered
 * with default states of installed: false and enabled: false.
 */
const pluginMetadataSchema = new Schema<IPluginMetadataDocument>(
    {
        id: {
            type: String,
            required: true,
            unique: true,
            index: true
        },
        title: {
            type: String,
            required: true
        },
        version: {
            type: String,
            required: true
        },
        installed: {
            type: Boolean,
            required: true,
            default: false,
            index: true
        },
        enabled: {
            type: Boolean,
            required: true,
            default: false,
            index: true
        },
        discoveredAt: {
            type: Date,
            required: true,
            default: Date.now
        },
        installedAt: {
            type: Date,
            default: null
        },
        enabledAt: {
            type: Date,
            default: null
        },
        disabledAt: {
            type: Date,
            default: null
        },
        uninstalledAt: {
            type: Date,
            default: null
        },
        lastError: {
            type: String,
            default: null
        },
        lastErrorAt: {
            type: Date,
            default: null
        }
    },
    {
        timestamps: true,
        collection: 'plugin_metadata'
    }
);

// Compound index for common queries
pluginMetadataSchema.index({ installed: 1, enabled: 1 });

/**
 * Mongoose model for plugin metadata.
 *
 * Provides database access for plugin state management including
 * installation status, enabled state, and lifecycle timestamps.
 */
export const PluginMetadata = mongoose.model<IPluginMetadataDocument>('PluginMetadata', pluginMetadataSchema);
