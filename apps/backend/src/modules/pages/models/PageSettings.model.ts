import mongoose, { Schema, type Document } from 'mongoose';
import type { IPageSettings } from '@tronrelic/types';

/**
 * Mongoose document interface for PageSettings model.
 * Combines IPageSettings interface with Mongoose Document properties.
 */
export interface IPageSettingsDocument extends Omit<IPageSettings, '_id'>, Document {}

/**
 * Default configuration values for the pages module.
 * These defaults are used when creating a new settings document.
 */
export const DEFAULT_PAGE_SETTINGS: Omit<IPageSettings, '_id' | 'updatedAt'> = {
    blacklistedRoutes: ['/api', '/system', '/_next', '/uploads'],
    maxFileSize: 10485760, // 10MB in bytes
    allowedFileExtensions: ['.png', '.jpg', '.jpeg', '.ico', '.svg'],
    filenameSanitizationPattern: '[^a-z0-9-_.]',
    storageProvider: 'local',
};

/**
 * Mongoose schema for pages module configuration.
 *
 * Settings control route conflicts, file upload validation, and storage provider selection.
 * Stored as a singleton document (only one settings document exists in the collection).
 */
const PageSettingsSchema = new Schema<IPageSettingsDocument>(
    {
        blacklistedRoutes: {
            type: [String],
            required: true,
            default: DEFAULT_PAGE_SETTINGS.blacklistedRoutes,
        },
        maxFileSize: {
            type: Number,
            required: true,
            default: DEFAULT_PAGE_SETTINGS.maxFileSize,
            min: 1,
        },
        allowedFileExtensions: {
            type: [String],
            required: true,
            default: DEFAULT_PAGE_SETTINGS.allowedFileExtensions,
        },
        filenameSanitizationPattern: {
            type: String,
            required: true,
            default: DEFAULT_PAGE_SETTINGS.filenameSanitizationPattern,
        },
        storageProvider: {
            type: String,
            required: true,
            enum: ['local', 's3', 'cloudflare'],
            default: DEFAULT_PAGE_SETTINGS.storageProvider,
        },
        updatedAt: {
            type: Date,
            default: () => new Date(),
        },
    },
    {
        collection: 'page_settings',
    }
);

/**
 * Mongoose model for PageSettings documents.
 */
export const PageSettingsModel = mongoose.model<IPageSettingsDocument>(
    'PageSettings',
    PageSettingsSchema
);
