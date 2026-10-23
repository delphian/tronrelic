/**
 * @file IContentTranslationSettings.ts
 *
 * The AI settings every content translation Suggest request uses, whatever the
 * content type. One setting serves all content, so a glossary written once
 * applies to pages and blog posts alike. Interface text has its own settings
 * on the localization module, because short interface strings usually want
 * different instructions than articles.
 */

/**
 * Model choice and system prompt for content translation suggestions.
 */
export interface IContentTranslationSettings {
    /**
     * System prompt sent ahead of every Suggest request: the site's tone and a
     * glossary. Falls back to a built-in default until an administrator saves
     * their own.
     */
    systemPrompt: string;

    /** Registry id of the AI provider that runs suggestions, or null for whichever is active. */
    providerId: string | null;

    /** Model id on that provider, or null for the provider's default model. */
    model: string | null;

    /** When the settings were last saved, or null while the defaults still apply. */
    updatedAt: Date | null;
}
