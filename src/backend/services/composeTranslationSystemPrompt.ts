/**
 * @fileoverview Build the system prompt an AI translation request is sent
 * with, from the feature's shared prompt and the target language's own
 * guidance.
 *
 * Both Suggest features, interface text in the localization module and managed
 * content in the core content service, translate into the same languages. A
 * language's glossary and style rules therefore live on the language and are
 * added here, so both features follow them and no other language's requests
 * carry them.
 *
 * @module backend/services/composeTranslationSystemPrompt
 */

/** The parts of a language the composed prompt names and draws guidance from. */
export interface ITranslationPromptLanguage {
    /** BCP 47 code, named in the guidance heading. */
    code: string;
    /** English name, named in the guidance heading. */
    name: string;
    /** The language's own guidance; empty or absent when it has none. */
    translationPrompt?: string;
}

/**
 * Append the target language's guidance to a feature's shared system prompt.
 *
 * The guidance goes after the shared prompt under a heading naming the
 * language, so the model reads it as the more specific rule when the two
 * overlap. A language with no guidance gets the shared prompt unchanged.
 *
 * @param systemPrompt - The feature's shared prompt from its settings, holding
 *   the tone and rules that apply to every language.
 * @param language - The language being translated into.
 * @returns The system prompt to send with the request.
 */
export function composeTranslationSystemPrompt(systemPrompt: string, language: ITranslationPromptLanguage): string {
    const guidance = language.translationPrompt?.trim() ?? '';
    const composed = guidance === ''
        ? systemPrompt
        : `${systemPrompt}\n\nGuidance for translating into ${language.name} (${language.code}). Where it differs from the instructions above, follow it:\n${guidance}`;

    return composed;
}
