/**
 * @file files-settings.service.ts
 *
 * Singleton implementation of `IFilesSettingsService`. Owns the
 * `module_files_settings` collection — the platform-wide upload policy
 * (max size, allowed extensions, filename sanitization, provider choice)
 * that every consumer of `IFileService.upload` honors.
 */

import { ObjectId, type Collection } from 'mongodb';
import type { IDatabaseService, IFilesSettings, IFilesSettingsService, ISystemLogService } from '@/types';
import type { IFilesSettingsDocument } from '../database/index.js';
import { DEFAULT_FILES_SETTINGS } from '../database/index.js';

export const FILES_SETTINGS_COLLECTION = 'module_files_settings';

/**
 * Singleton settings service. `setDependencies()` runs from
 * `FilesModule.init()`; `getInstance()` is the canonical accessor.
 */
export class FilesSettingsService implements IFilesSettingsService {
    private static instance: FilesSettingsService;

    private readonly settingsCollection: Collection<IFilesSettingsDocument>;

    private constructor(
        private readonly database: IDatabaseService,
        private readonly logger: ISystemLogService
    ) {
        this.settingsCollection = database.getCollection<IFilesSettingsDocument>(FILES_SETTINGS_COLLECTION);
    }

    public static setDependencies(database: IDatabaseService, logger: ISystemLogService): void {
        if (!FilesSettingsService.instance) {
            FilesSettingsService.instance = new FilesSettingsService(database, logger);
        }
    }

    public static getInstance(): FilesSettingsService {
        if (!FilesSettingsService.instance) {
            throw new Error('FilesSettingsService.setDependencies() must be called before getInstance()');
        }
        return FilesSettingsService.instance;
    }

    public static resetForTests(): void {
        (FilesSettingsService as unknown as { instance: FilesSettingsService | undefined }).instance = undefined;
    }

    async getSettings(): Promise<IFilesSettings> {
        let doc = await this.settingsCollection.findOne({});
        if (!doc) {
            doc = {
                _id: new ObjectId(),
                ...DEFAULT_FILES_SETTINGS,
                updatedAt: new Date(),
            };
            await this.settingsCollection.insertOne(doc);
            this.logger.info('Created default files settings');
        }
        return this.toIFilesSettings(doc);
    }

    async updateSettings(updates: Partial<IFilesSettings>): Promise<IFilesSettings> {
        let doc = await this.settingsCollection.findOne({});
        if (!doc) {
            doc = {
                _id: new ObjectId(),
                ...DEFAULT_FILES_SETTINGS,
                updatedAt: new Date(),
            };
            await this.settingsCollection.insertOne(doc);
        }

        if (updates.maxFileSize !== undefined && updates.maxFileSize < 1) {
            throw new Error('Maximum file size must be at least 1 byte');
        }

        const updateDoc: Record<string, unknown> = { updatedAt: new Date() };
        if (updates.maxFileSize !== undefined) updateDoc.maxFileSize = updates.maxFileSize;
        if (updates.allowedFileExtensions !== undefined) updateDoc.allowedFileExtensions = updates.allowedFileExtensions;
        if (updates.filenameSanitizationPattern !== undefined) updateDoc.filenameSanitizationPattern = updates.filenameSanitizationPattern;
        if (updates.storageProvider !== undefined) updateDoc.storageProvider = updates.storageProvider;

        await this.settingsCollection.updateOne({ _id: doc._id }, { $set: updateDoc });
        this.logger.info('Updated files settings');

        const updated = await this.settingsCollection.findOne({ _id: doc._id });
        if (!updated) {
            throw new Error('Failed to retrieve updated files settings');
        }
        return this.toIFilesSettings(updated);
    }

    private toIFilesSettings(doc: IFilesSettingsDocument): IFilesSettings {
        return {
            _id: doc._id.toString(),
            maxFileSize: doc.maxFileSize,
            allowedFileExtensions: doc.allowedFileExtensions,
            filenameSanitizationPattern: doc.filenameSanitizationPattern,
            storageProvider: doc.storageProvider,
            updatedAt: doc.updatedAt,
        };
    }
}
