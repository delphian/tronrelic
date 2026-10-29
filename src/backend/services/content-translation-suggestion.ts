/**
 * @fileoverview Asks an AI model to translate a content item for the
 * translation editor.
 *
 * Translating a whole item by hand is slow, so the editor offers a Suggest
 * button. It lands here: the service takes the English values (and a stale
 * earlier translation to update), sends them to the provider and model chosen
 * in the content translation settings, and returns translated values. It never
 * saves anything. The editor places the values in its fields and the
 * administrator decides what to keep, exactly as the localization module's
 * Suggest buttons work for interface text.
 *
 * The provider comes from the core `'ai-providers'` registry, and the request
 * runs with no tools and no `{%variable%}` expansion, because content is
 * written by authors and must not be able to invoke a tool or pull a stored
 * value into the prompt.
 *
 * @module backend/services/content-translation-suggestion
 */

import type {
    IAiProviderRegistry,
    IContentTranslationSettings,
    IContentTranslationSuggestion,
    ILocalizationService,
    ISystemLogService,
    ITranslatableField,
    TranslationValues
} from '@/types';
import { DEFAULT_LANGUAGE, LANGUAGE_CODE_PATTERN } from '@/types';
import { ContentError } from './content-error.js';
import { resolveAiProvider, type IAiFeatureWording } from './resolveAiProvider.js';
import { runIsolatedAiQuery } from './runIsolatedAiQuery.js';
import { resolveAiOutputBudget, DEFAULT_AI_OUTPUT_BUDGET_POLICY } from './resolveAiOutputBudget.js';
import { composeTranslationSystemPrompt } from './composeTranslationSystemPrompt.js';
import { ContentTranslationProviderError, ContentTranslationUnavailableError } from './content-translation-errors.js';
import {
    buildContentTranslationPrompt,
    estimateTranslationOutputTokens,
    parseContentTranslationReply,
    type IParsedContentTranslation
} from './content-translation-prompt.js';

/** Output tokens budgeted for the JSON wrapper and the notes. */
const BASE_OUTPUT_TOKENS = 1024;

/** How this feature names itself and its settings in provider refusals. */
const SUGGESTION_WORDING: IAiFeatureWording = {
    featureName: 'content translation suggestions',
    settingsLocation: 'the Content translation panel on the System → Localization Settings tab'
};

/** What a suggestion is built from, gathered by the translation service. */
export interface IContentTranslationSuggestionSource {
    /** The content type's translatable fields. */
    fields: ReadonlyArray<ITranslatableField>;
    /** The English values. */
    english: TranslationValues;
    /** The existing translation's values when it is stale, otherwise null. */
    previous: TranslationValues | null;
    /** The existing translation's values, used to carry `url` fields over; null when there is none. */
    existing: TranslationValues | null;
}

/** Collaborators the suggestion service needs. */
export interface IContentTranslationSuggestionDependencies {
    /** Source of the system prompt, provider, and model. */
    settings: { getSettings(): Promise<IContentTranslationSettings> };
    /**
     * Looks up the core AI provider registry at the moment of a request. A
     * function rather than a value because the registry is published after
     * the content service is built, and providers come and go as plugins are
     * enabled.
     */
    getProviderRegistry: () => IAiProviderRegistry | null;
    /**
     * Looks up the localization service at the moment of a request, for the
     * target language's names and translation guidance. A function for the same reason: the
     * localization module publishes it after the content service is built.
     */
    getLocalization: () => ILocalizationService | null;
    /** Scoped logger; every run is recorded with its actor, usage, and cost. */
    logger: ISystemLogService;
}

/**
 * Produces machine translations of content items for the translation editor to review.
 */
export class ContentTranslationSuggestionService {
    /**
     * @param deps - Collaborators wired by the content service.
     */
    constructor(private readonly deps: IContentTranslationSuggestionDependencies) {}

    /**
     * Translate an item into one language.
     *
     * @param target - What is being translated, for the log: type, id, and language.
     * @param source - The fields and the English and existing values.
     * @param actorId - Who asked, for the log.
     * @returns The suggested values, the model's notes, and the cost.
     * @throws Error for a malformed language code; ContentError `not-found` for a
     *   language not configured on `/system/localization`;
     *   ContentTranslationUnavailableError when no provider can run it;
     *   ContentTranslationProviderError when the model's answer cannot be used.
     */
    async suggest(
        target: { typeId: string; id: string; language: string },
        source: IContentTranslationSuggestionSource,
        actorId: string
    ): Promise<IContentTranslationSuggestion> {
        const { typeId, id, language } = target;
        if (!LANGUAGE_CODE_PATTERN.test(language) || language === DEFAULT_LANGUAGE) {
            throw new Error(`"${language}" is not a language content can be translated into`);
        }
        const targetLanguage = await this.deps.getLocalization()?.getLanguage(language) ?? null;
        if (!targetLanguage) {
            throw new ContentError('not-found', `Language "${language}" is not configured. Add it in System → Localization first.`);
        }
        const settings = await this.deps.settings.getSettings();
        const { provider, providerId } = resolveAiProvider(
            this.deps.getProviderRegistry(),
            settings.providerId,
            SUGGESTION_WORDING,
            /**
             * Wrap a "no provider can run this" explanation so the admin
             * route answers it with 503.
             *
             * @param message - Why no provider is available.
             * @returns The error to throw.
             */
            (message) => new ContentTranslationUnavailableError(message)
        );
        const model = settings.model ?? undefined;
        const budget = await resolveAiOutputBudget(
            provider,
            model,
            estimateTranslationOutputTokens(language, source.fields, source.english, BASE_OUTPUT_TOKENS),
            DEFAULT_AI_OUTPUT_BUDGET_POLICY
        );
        // The budget is logged with every outcome so a cut-off reply can be
        // read against the ceiling that cut it and where that ceiling came from.
        const logContext = {
            actor: actorId,
            typeId,
            id,
            language,
            providerId,
            maxTokens: budget.maxTokens,
            timeoutMs: budget.timeoutMs,
            outputLimit: budget.outputLimit,
            limitSource: budget.limitSource
        };

        const result = await runIsolatedAiQuery(
            provider,
            {
                prompt: buildContentTranslationPrompt(targetLanguage, source.fields, source.english, source.previous),
                systemPrompt: composeTranslationSystemPrompt(settings.systemPrompt, targetLanguage),
                model,
                maxTokens: budget.maxTokens,
                timeoutMs: budget.timeoutMs,
                refusalMessage: 'The model declined to translate this content.',
                maxTokensMessage: this.maxTokensMessage(budget.limitSource),
                settingsLocation: SUGGESTION_WORDING.settingsLocation
            },
            /**
             * Log a failed run, with the budget it ran under and how far the
             * model got, and wrap its explanation so the admin route answers
             * it with 502.
             *
             * @param message - Why the provider's answer cannot be used.
             * @param failure - The stop reason, usage, and reply size, or the
             *   transport error, so the log shows what the message alone cannot.
             * @returns The error to throw.
             */
            (message, failure) => {
                this.deps.logger.warn({ ...logContext, ...failure, message }, 'Content translation suggestion request failed');
                return new ContentTranslationProviderError(message);
            }
        );

        let parsed: IParsedContentTranslation;
        try {
            parsed = parseContentTranslationReply(result.responseText, source.fields);
        } catch (error) {
            this.deps.logger.warn({ ...logContext, model: result.model, error }, 'Content translation suggestion reply could not be read');
            throw new ContentTranslationProviderError(
                `${error instanceof Error ? error.message : 'The reply could not be read'}. Try again, or choose a different model in the content translation settings.`
            );
        }

        const costUsd = typeof result.costUsd === 'number' ? result.costUsd : null;
        this.deps.logger.info(
            {
                ...logContext,
                updatedStale: source.previous !== null,
                model: result.model,
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                costUsd
            },
            'Content translation suggestion generated'
        );

        return {
            values: this.withUrlFields(source, parsed.values),
            notes: parsed.notes,
            providerId,
            model: result.model,
            costUsd,
            usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
        };
    }

    /**
     * Word the cut-off explanation by what the administrator can actually
     * change. When the budget was capped at the chosen model's own limit, a
     * model with a larger limit is the fix. When the fallback ceiling applied,
     * the provider's default model is in use and its limit was never read, so
     * naming a model in the settings lets the full limit be used.
     *
     * @param limitSource - Where the ceiling that cut the reply came from.
     * @returns The explanation shown when the reply hit the token limit.
     */
    private maxTokensMessage(limitSource: 'model' | 'fallback'): string {
        const remedy = limitSource === 'model'
            ? 'choose a model with a larger output limit in the content translation settings'
            : 'choose a specific model in the content translation settings so its full output limit can be used';

        return `The model ran out of output space before finishing. The content may be too long to translate in one request; ${remedy}, or translate part of it by hand.`;
    }

    /**
     * Add the `url` fields the model never sees, carried over from the
     * existing translation so a suggestion never clears an image the
     * translator chose.
     *
     * @param source - The fields and the existing translation's values.
     * @param translated - The model's values for the fields it translated.
     * @returns A value for every declared field.
     */
    private withUrlFields(source: IContentTranslationSuggestionSource, translated: TranslationValues): TranslationValues {
        const values: TranslationValues = { ...translated };
        for (const field of source.fields) {
            if (field.kind === 'url') {
                const existing = source.existing?.[field.name];
                values[field.name] = typeof existing === 'string' ? existing : '';
            }
        }

        return values;
    }
}
