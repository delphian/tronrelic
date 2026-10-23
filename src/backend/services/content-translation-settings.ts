/**
 * @fileoverview The AI settings every content translation Suggest request uses.
 *
 * One settings document serves every translatable content type, so a glossary
 * written once applies to pages and blog posts alike, and a new content type
 * gets working suggestions without its own settings screen. Interface text
 * keeps separate settings on the localization module, because short interface
 * strings usually want different instructions than articles.
 *
 * @module backend/services/content-translation-settings
 */

import type { IContentTranslationSettings, IDatabaseService } from '@/types';
import { normalizeAiId } from './normalizeAiId.js';
import { normalizeAiSystemPrompt } from './normalizeAiSystemPrompt.js';
import { DEFAULT_CONTENT_TRANSLATION_SYSTEM_PROMPT } from './content-translation-prompt.js';

/** Core collection holding the single settings document. */
export const CONTENT_TRANSLATION_SETTINGS_COLLECTION = 'content_translation_settings';

/** Fixed key of the one settings document, so a write can upsert it. */
const SETTINGS_KEY = 'settings';

/** Longest system prompt accepted. Long enough for a sizeable glossary. */
const MAX_SYSTEM_PROMPT_LENGTH = 8000;

/** The stored settings document. Absent fields mean the defaults apply. */
export interface IContentTranslationSettingsDocument {
    /** Always `'settings'`. */
    key: string;
    /** The administrator's system prompt; absent until one is saved. */
    systemPrompt?: string;
    /** Provider id; absent or null for the active provider. */
    providerId?: string | null;
    /** Model id; absent or null for the provider's default. */
    model?: string | null;
    /** When the document was last written. */
    updatedAt: Date;
}

/**
 * Build the plain error a settings validation failure throws, which the admin
 * route answers with 400.
 *
 * @param message - Explanation shown to the administrator.
 * @returns The error to throw.
 */
const invalidSetting = (message: string): Error => new Error(message);

/**
 * Reads and writes the content translation settings.
 */
export class ContentTranslationSettingsService {
    /**
     * @param database - Core database holding the settings collection.
     */
    constructor(private readonly database: IDatabaseService) {}

    /**
     * Read the settings, filling in the defaults for anything not saved yet.
     *
     * @returns The settings.
     */
    async getSettings(): Promise<IContentTranslationSettings> {
        const doc = await this.collection().findOne({ key: SETTINGS_KEY });

        return this.toSettings(doc);
    }

    /**
     * Apply a partial change. Changing the provider without naming a model
     * clears the model, because a model id only means something on the
     * provider that offers it.
     *
     * @param updates - The fields to change.
     * @returns The settings after the change.
     * @throws Error when the prompt is empty or too long, or an id is malformed.
     */
    async updateSettings(
        updates: Partial<Omit<IContentTranslationSettings, 'updatedAt'>>
    ): Promise<IContentTranslationSettings> {
        const current = await this.collection().findOne({ key: SETTINGS_KEY });
        const set: Record<string, unknown> = { updatedAt: new Date() };

        if (updates.systemPrompt !== undefined) {
            set.systemPrompt = normalizeAiSystemPrompt(updates.systemPrompt, MAX_SYSTEM_PROMPT_LENGTH, invalidSetting);
        }
        if (updates.providerId !== undefined) {
            set.providerId = normalizeAiId(updates.providerId, 'provider', invalidSetting);
            if (updates.model === undefined && set.providerId !== (current?.providerId ?? null)) {
                set.model = null;
            }
        }
        if (updates.model !== undefined) {
            set.model = normalizeAiId(updates.model, 'model', invalidSetting);
        }

        await this.collection().updateOne({ key: SETTINGS_KEY }, { $set: set }, { upsert: true });

        return this.getSettings();
    }

    /**
     * The typed handle on the settings collection.
     *
     * @returns The collection.
     */
    private collection() {
        return this.database.getCollection<IContentTranslationSettingsDocument>(CONTENT_TRANSLATION_SETTINGS_COLLECTION);
    }

    /**
     * Map the stored document to the API shape, with defaults for missing fields.
     *
     * @param doc - The stored document, or null before the first save.
     * @returns The settings.
     */
    private toSettings(doc: IContentTranslationSettingsDocument | null): IContentTranslationSettings {
        return {
            systemPrompt: doc?.systemPrompt ?? DEFAULT_CONTENT_TRANSLATION_SYSTEM_PROMPT,
            providerId: doc?.providerId ?? null,
            model: doc?.model ?? null,
            updatedAt: doc?.updatedAt ?? null
        };
    }
}
