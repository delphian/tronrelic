/**
 * @fileoverview Stored shape of the localization module's settings.
 */

/**
 * The single document in `module_localization_settings`, found by its fixed
 * `key`. The wire form is `ILocalizationSettings`.
 */
export interface ILocalizationSettingsDocument {
    /** Always `'settings'`; the unique index on it keeps the collection to one document. */
    key: 'settings';
    /** System prompt sent ahead of every translation request. */
    systemPrompt: string;
    /** AI provider id, or null for the active provider. */
    providerId: string | null;
    /** Model id, or null for the provider's default. */
    model: string | null;
    /** Last save. */
    updatedAt: Date;
    /** Who saved it last. */
    updatedBy: string | null;
}
