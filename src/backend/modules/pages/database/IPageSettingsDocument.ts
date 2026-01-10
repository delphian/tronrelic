import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for page settings.
 *
 * Represents the database schema for pages module configuration settings.
 * The _id field is stored as ObjectId in the database but converted to string
 * in the IPageSettings interface for framework independence.
 *
 * This interface is used with the native MongoDB driver (not Mongoose) to provide
 * direct collection access through the IDatabaseService dependency injection pattern.
 *
 * @example
 * ```typescript
 * const collection = database.getCollection<IPageSettingsDocument>('page_settings');
 * const settings = await collection.findOne({});
 * ```
 */
export interface IPageSettingsDocument {
    _id: ObjectId;
    blacklistedRoutes: string[];
    maxFileSize: number;
    allowedFileExtensions: string[];
    filenameSanitizationPattern: string;
    storageProvider: 'local' | 's3' | 'cloudflare';
    updatedAt: Date;
}

/**
 * Default settings for pages module.
 *
 * Applied when no settings document exists in the database (first initialization).
 */
export const DEFAULT_PAGE_SETTINGS: Omit<IPageSettingsDocument, '_id' | 'updatedAt'> = {
    blacklistedRoutes: [
        '^/api/.*',
        '^/system/.*',
        '^/admin/.*',
        '^/_next/.*',
        '^/markets$',
        '^/accounts$',
        '^/transactions$',
        '^/whales$',
    ],
    maxFileSize: 10 * 1024 * 1024, // 10 MB
    allowedFileExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.pdf'],
    filenameSanitizationPattern: '[^a-z0-9-_.]',
    storageProvider: 'local',
};
