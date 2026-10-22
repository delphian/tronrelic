/**
 * @fileoverview Asks an AI model to translate a CMS page for the translation
 * editor on `/system/pages`.
 *
 * Translating a whole page by hand is slow, so the editor offers a Suggest
 * button. It lands here: the service gathers the English page (and a stale
 * earlier translation to update), sends it to the provider and model chosen on
 * the Pages Settings tab, and returns the translation as markdown. It never
 * saves anything. The editor places the text in the translation pane and the
 * administrator decides what to keep, exactly as the localization module's
 * Suggest buttons work for interface text.
 *
 * The provider comes from the core `'ai-providers'` registry, and the request
 * runs with no tools and no `{%variable%}` expansion, because page text is
 * written by authors and must not be able to invoke a tool or pull a stored
 * value into the prompt.
 *
 * @module backend/modules/pages/services/page-translation-suggestion.service
 */

import type {
    IAiProviderRegistry,
    ILocalizationService,
    IPageSettings,
    IPageTranslationSuggestionResult,
    ISystemLogService
} from '@/types';
import { DEFAULT_LANGUAGE, LANGUAGE_CODE_PATTERN } from '@/types';
import { ContentError } from '../../../services/content-error.js';
import { resolveAiProvider, type IAiFeatureWording } from '../../../services/resolveAiProvider.js';
import { runIsolatedAiQuery } from '../../../services/runIsolatedAiQuery.js';
import { PageTranslationProviderError, PageTranslationUnavailableError } from './page-translation-errors.js';
import {
    assemblePageTranslationMarkdown,
    buildPageTranslationPrompt,
    parsePageTranslationReply,
    type IPageTranslationFields,
    type IParsedPageTranslation
} from './page-translation-prompt.js';
import type { IPageTranslationSuggestionSource } from './page-translation.service.js';

/** How long one request may take before it is abandoned. A long page takes a while to write. */
const QUERY_TIMEOUT_MS = 180_000;

/** Output tokens budgeted for the JSON wrapper and the notes. */
const BASE_OUTPUT_TOKENS = 1024;

/** Ceiling on the output budget, kept under what current models accept. */
const MAX_OUTPUT_TOKENS = 16_000;

/** How this feature names itself and its settings in provider refusals. */
const SUGGESTION_WORDING: IAiFeatureWording = {
    featureName: 'page translation suggestions',
    settingsLocation: 'the Pages Settings tab'
};

/** Where the suggestion service reads the text to translate. */
export interface IPageTranslationSourceLoader {
    /**
     * Gather the English page and any stale translation to update.
     *
     * @param pageId - The page's core content id.
     * @param language - Language code of the translation.
     * @returns The source fields and the existing translation's settings.
     */
    getSuggestionSource(pageId: string, language: string): Promise<IPageTranslationSuggestionSource>;
}

/** Collaborators the suggestion service needs. */
export interface IPageTranslationSuggestionServiceDependencies {
    /** Reads the English page and the existing translation. */
    source: IPageTranslationSourceLoader;
    /** Source of the system prompt, provider, and model. */
    settings: { getSettings(): Promise<IPageSettings> };
    /**
     * Looks up the core AI provider registry at the moment of a request. A
     * function rather than a value because the registry is published after
     * this module starts, and providers come and go as plugins are enabled.
     */
    getProviderRegistry: () => IAiProviderRegistry | null;
    /**
     * Looks up the localization service at the moment of a request, for the
     * target language's names. A function for the same reason as above: the
     * localization module publishes it after this module starts.
     */
    getLocalization: () => ILocalizationService | null;
    /** Module-scoped logger; every run is recorded with its actor, usage, and cost. */
    logger: ISystemLogService;
}

/**
 * Produces machine translations of CMS pages for the translation editor to review.
 */
export class PageTranslationSuggestionService {
    private readonly source: IPageTranslationSourceLoader;
    private readonly settings: { getSettings(): Promise<IPageSettings> };
    private readonly getProviderRegistry: () => IAiProviderRegistry | null;
    private readonly getLocalization: () => ILocalizationService | null;
    private readonly logger: ISystemLogService;

    /**
     * @param deps - Collaborators wired by the module.
     */
    constructor(deps: IPageTranslationSuggestionServiceDependencies) {
        this.source = deps.source;
        this.settings = deps.settings;
        this.getProviderRegistry = deps.getProviderRegistry;
        this.getLocalization = deps.getLocalization;
        this.logger = deps.logger;
    }

    /**
     * Translate a page into one language.
     *
     * @param pageId - The page's core content id.
     * @param language - Target language code.
     * @param actor - Who asked, for the log.
     * @returns The suggested markdown, the model's notes, and the cost.
     * @throws Error for a malformed language code; ContentError `not-found` for an
     *   unknown page or a language not configured on `/system/localization`;
     *   PageTranslationUnavailableError when no provider can run it;
     *   PageTranslationProviderError when the model's answer cannot be used.
     */
    async suggest(pageId: string, language: string, actor: string): Promise<IPageTranslationSuggestionResult> {
        if (!LANGUAGE_CODE_PATTERN.test(language) || language === DEFAULT_LANGUAGE) {
            throw new Error(`"${language}" is not a language a page can be translated into`);
        }
        const target = await this.getLocalization()?.getLanguage(language) ?? null;
        if (!target) {
            throw new ContentError('not-found', `Language "${language}" is not configured. Add it in System → Localization first.`);
        }
        const source = await this.source.getSuggestionSource(pageId, language);
        const settings = await this.settings.getSettings();
        const { provider, providerId } = resolveAiProvider(
            this.getProviderRegistry(),
            settings.translationProviderId,
            SUGGESTION_WORDING,
            (message) => new PageTranslationUnavailableError(message)
        );

        const result = await runIsolatedAiQuery(
            provider,
            {
                prompt: buildPageTranslationPrompt(target, source.english, source.previous),
                systemPrompt: settings.translationSystemPrompt,
                model: settings.translationModel ?? undefined,
                maxTokens: estimateOutputTokens(source.english),
                timeoutMs: QUERY_TIMEOUT_MS,
                refusalMessage: 'The model declined to translate this page.',
                maxTokensMessage: 'The model ran out of output space before finishing. The page may be too long to translate in one request; choose a model with a larger output limit on the Pages Settings tab, or translate part of it by hand.',
                settingsLocation: SUGGESTION_WORDING.settingsLocation
            },
            (message) => {
                this.logger.warn({ actor, pageId, language, providerId, message }, 'Page translation suggestion request failed');
                return new PageTranslationProviderError(message);
            }
        );

        let parsed: IParsedPageTranslation;
        try {
            parsed = parsePageTranslationReply(result.responseText);
        } catch (error) {
            this.logger.warn({ actor, pageId, language, providerId, model: result.model, error }, 'Page translation suggestion reply could not be read');
            throw new PageTranslationProviderError(
                `${error instanceof Error ? error.message : 'The reply could not be read'}. Try again, or choose a different model on the Pages Settings tab.`
            );
        }

        const costUsd = typeof result.costUsd === 'number' ? result.costUsd : null;
        this.logger.info(
            {
                actor,
                pageId,
                language,
                updatedStale: source.previous !== null,
                providerId,
                model: result.model,
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                costUsd
            },
            'Page translation suggestion generated'
        );

        return {
            content: assemblePageTranslationMarkdown(parsed, source.published, source.ogImage),
            notes: parsed.notes,
            providerId,
            model: result.model,
            costUsd,
            usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
        };
    }
}

/**
 * Size the output budget to the page, so a short page does not reserve the
 * same budget as a long one. English runs about four characters per token;
 * allowing one token per source character leaves room for languages that need
 * more tokens than English for the same text.
 *
 * @param english - The English page's translatable fields.
 * @returns Output tokens to allow.
 */
function estimateOutputTokens(english: IPageTranslationFields): number {
    const sourceCharacters = english.title.length
        + english.description.length
        + english.keywords.join(' ').length
        + english.body.length;

    return Math.min(MAX_OUTPUT_TOKENS, BASE_OUTPUT_TOKENS + sourceCharacters);
}
