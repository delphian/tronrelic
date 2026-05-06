import { ObjectId } from 'mongodb';

/**
 * MongoDB document interface for the Files module's settings singleton.
 *
 * Stored in `module_files_settings`. These fields previously lived on the
 * `page_settings` document; they were extracted by migration
 * `module:files:001_files_settings` so file-upload policy is owned by a
 * single module rather than co-located with page concerns.
 */
export interface IFilesSettingsDocument {
    _id: ObjectId;
    maxFileSize: number;
    allowedFileExtensions: string[];
    filenameSanitizationPattern: string;
    storageProvider: 'local' | 's3' | 'cloudflare';
    updatedAt: Date;
}

/**
 * Default settings applied when no settings document exists yet.
 */
export const DEFAULT_FILES_SETTINGS: Omit<IFilesSettingsDocument, '_id' | 'updatedAt'> = {
    maxFileSize: 10 * 1024 * 1024,
    allowedFileExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.pdf'],
    filenameSanitizationPattern: '[^a-z0-9-_.]',
    storageProvider: 'local',
};
