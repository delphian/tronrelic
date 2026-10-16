/**
 * @fileoverview Settings for the localization module's AI translation assist.
 */

/**
 * What the Settings tab on `/system/localization` stores. The translation
 * buttons on the Translations tab read these on every request, so a change
 * applies to the next click without a restart.
 */
export interface ILocalizationSettings {
    /**
     * Instructions sent as the model's system prompt ahead of every
     * translation request. This is where an administrator keeps the site's
     * tone and glossary, such as "TRON is always 波场", so every suggestion
     * follows the same terms.
     */
    systemPrompt: string;

    /**
     * AI provider the buttons use, by its registry id. Null means whichever
     * provider is active when the button is clicked.
     */
    providerId: string | null;

    /**
     * Model on that provider. Null means the provider's own default model.
     */
    model: string | null;

    /** Last save, or null before the settings were first saved. */
    updatedAt: string | null;

    /** Who saved them last, or null before the first save. */
    updatedBy: string | null;
}
