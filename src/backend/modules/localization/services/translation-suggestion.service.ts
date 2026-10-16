/**
 * @fileoverview Asks an AI model to translate keys for the Translations tab.
 *
 * Translating key by key is slow work for an administrator, so the tab offers
 * a button per row and one for the visible page. Both land here. The service
 * looks up the keys, sends them to the provider chosen on the Settings tab in
 * one request, and returns the suggested text. It never saves anything: the tab
 * places the text in the editors and the administrator decides what to keep.
 *
 * The provider comes from the core `'ai-providers'` registry, never from a
 * vendor's own service name, so the feature keeps working when a different
 * provider plugin is installed. The call runs with no tools and with
 * `{%variable%}` expansion switched off. The English text comes from the site
 * and from plugins, so it must not be able to invoke a tool or pull a stored
 * value into the prompt.
 */

import type {
    IAiProvider,
    IAiProviderRegistry,
    IAiQueryResult,
    IDatabaseService,
    ILocalizationSettings,
    ISystemLogService,
    ITranslationSuggestionRequest,
    ITranslationSuggestionResult
} from '@/types';
import { MAX_TRANSLATION_SUGGESTION_KEYS } from '@/types';
import type { ILanguageDocument, ITranslationDocument, ITranslationKeyDocument } from '../database/index.js';
import { KEYS_COLLECTION, LANGUAGES_COLLECTION, TRANSLATIONS_COLLECTION } from '../database/index.js';
import {
    LocalizationNotFoundError,
    LocalizationProviderError,
    LocalizationUnavailableError,
    LocalizationValidationError
} from './localization-errors.js';
import { KEY_PATTERN, joinKeyId } from './translation-key-rules.js';
import { buildSuggestionPrompt, parseSuggestionReply, type IParsedSuggestionReply, type ISuggestionItem } from './translation-suggestion-prompt.js';

/** How long one request may take before it is abandoned. A full page can take a while to write. */
const QUERY_TIMEOUT_MS = 180_000;

/** Output tokens budgeted for the JSON wrapper and the general notes. */
const BASE_OUTPUT_TOKENS = 512;

/** Output tokens budgeted per key for its id, quoting, and an optional note. */
const PER_KEY_OUTPUT_TOKENS = 60;

/** Ceiling on the output budget, kept under what current models accept. */
const MAX_OUTPUT_TOKENS = 16_000;

/** Collaborators the suggestion service needs. */
export interface ITranslationSuggestionServiceDependencies {
    /** Core database service, for the keys, languages, and saved translations. */
    database: IDatabaseService;
    /** Source of the system prompt, provider, and model. */
    settings: { getSettings(): Promise<ILocalizationSettings> };
    /**
     * Looks up the core AI provider registry at the moment of a request. A
     * function rather than a value because the registry is published after
     * this module starts, and providers come and go as plugins are enabled.
     */
    getProviderRegistry: () => IAiProviderRegistry | null;
    /** Module-scoped logger; every run is recorded with its actor, usage, and cost. */
    logger: ISystemLogService;
}

/**
 * Produces machine translations for the Translations tab to review.
 */
export class TranslationSuggestionService {
    private readonly database: IDatabaseService;
    private readonly settings: { getSettings(): Promise<ILocalizationSettings> };
    private readonly getProviderRegistry: () => IAiProviderRegistry | null;
    private readonly logger: ISystemLogService;

    /**
     * @param deps - Collaborators wired by the module.
     */
    constructor(deps: ITranslationSuggestionServiceDependencies) {
        this.database = deps.database;
        this.settings = deps.settings;
        this.getProviderRegistry = deps.getProviderRegistry;
        this.logger = deps.logger;
    }

    /**
     * Translate a batch of keys into one language.
     *
     * @param request - Target language and the keys to translate.
     * @param actor - Who asked, for the log.
     * @returns Suggested text per key, unanswered keys, the model's notes, and the cost.
     * @throws LocalizationValidationError for a malformed request, LocalizationNotFoundError
     *   for an unknown language or keys, LocalizationUnavailableError when no provider can
     *   run it, LocalizationProviderError when the model's answer cannot be used.
     */
    async suggest(request: ITranslationSuggestionRequest, actor: string): Promise<ITranslationSuggestionResult> {
        const language = await this.requireLanguage(request?.language);
        const items = await this.loadItems(this.requireKeyRefs(request?.keys), language.code);
        const settings = await this.settings.getSettings();
        const { provider, providerId } = this.resolveProvider(settings);

        const result = await this.runQuery(provider, {
            prompt: buildSuggestionPrompt(language, items),
            systemPrompt: settings.systemPrompt,
            model: settings.model ?? undefined,
            maxTokens: estimateOutputTokens(items)
        });

        let parsed: IParsedSuggestionReply;
        try {
            parsed = parseSuggestionReply(result.responseText, items);
        } catch (error) {
            this.logger.warn({ actor, providerId, model: result.model, error }, 'Translation suggestion reply could not be read');
            throw new LocalizationProviderError(
                `${error instanceof Error ? error.message : 'The reply could not be read'}. Try again, or choose a different model on the Settings tab.`
            );
        }

        const costUsd = typeof result.costUsd === 'number' ? result.costUsd : null;
        this.logger.info(
            {
                actor,
                language: language.code,
                requested: items.length,
                suggested: parsed.suggestions.length,
                providerId,
                model: result.model,
                inputTokens: result.usage.inputTokens,
                outputTokens: result.usage.outputTokens,
                costUsd
            },
            'Translation suggestions generated'
        );

        return {
            suggestions: parsed.suggestions,
            unanswered: parsed.unanswered,
            notes: parsed.notes,
            providerId,
            model: result.model,
            costUsd,
            usage: { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens }
        };
    }

    /**
     * Pick the provider the Settings tab names, or the active one when it
     * names none.
     *
     * A named provider that is no longer installed is an error rather than a
     * silent fallback to the active provider, because the administrator chose
     * that provider and its model on purpose, and the model id may mean
     * nothing to a different vendor.
     *
     * @param settings - Current settings.
     * @returns The provider instance and its registry id.
     */
    private resolveProvider(settings: ILocalizationSettings): { provider: IAiProvider; providerId: string } {
        const registry = this.getProviderRegistry();
        if (!registry) {
            throw new LocalizationUnavailableError('No AI provider is installed. Enable an AI provider plugin to use translation suggestions.');
        }

        let provider: IAiProvider | null;
        let providerId: string | undefined;
        if (settings.providerId) {
            provider = registry.getProvider(settings.providerId);
            providerId = settings.providerId;
            if (!provider) {
                throw new LocalizationUnavailableError(
                    `The AI provider "${settings.providerId}" chosen on the Settings tab is not installed. Choose another on the Settings tab.`
                );
            }
        } else {
            provider = registry.getActive();
            providerId = registry.listProviders().find(info => info.active)?.id;
            if (!provider || !providerId) {
                throw new LocalizationUnavailableError('No AI provider is active. Enable an AI provider plugin to use translation suggestions.');
            }
        }

        return { provider, providerId };
    }

    /**
     * Send the request and check the model actually answered.
     *
     * A returned result only means the transport worked. A refusal or a reply
     * cut off by the token limit also comes back as a result, and a cut-off
     * JSON reply would fail to parse with a confusing message, so both are
     * reported here in plain terms.
     *
     * @param provider - Provider to call.
     * @param options - Prompt, system prompt, model, and output budget.
     * @returns The provider's result.
     */
    private async runQuery(
        provider: IAiProvider,
        options: { prompt: string; systemPrompt: string; model: string | undefined; maxTokens: number }
    ): Promise<IAiQueryResult> {
        let result: IAiQueryResult;
        try {
            result = await provider.query({
                ...options,
                timeoutMs: QUERY_TIMEOUT_MS,
                thinkingBudget: 0,
                toolAllowlist: [],
                expandVariables: false,
                mode: 'programmatic'
            });
        } catch (error) {
            this.logger.warn({ error, model: options.model }, 'Translation suggestion request failed');
            throw new LocalizationProviderError(
                `The AI provider could not complete the request: ${error instanceof Error ? error.message : String(error)}`
            );
        }

        if (result.stopReason === 'refusal') {
            throw new LocalizationProviderError('The model declined to translate these strings.');
        }
        if (result.stopReason === 'max_tokens') {
            throw new LocalizationProviderError(
                'The model ran out of output space before finishing. Narrow the filters so fewer keys are on the page, then try again.'
            );
        }
        return result;
    }

    /**
     * Load the requested keys with their English and any saved translation.
     * Keys that no longer exist are dropped; if none remain, there is nothing
     * to translate.
     *
     * @param refs - Validated namespace and key pairs.
     * @param language - Target language code.
     * @returns The keys in request order.
     */
    private async loadItems(refs: Array<{ namespace: string; key: string }>, language: string): Promise<ISuggestionItem[]> {
        const pairs = refs.map(ref => ({ namespace: ref.namespace, key: ref.key }));
        const keys = await this.database
            .getCollection<ITranslationKeyDocument>(KEYS_COLLECTION)
            .find({ $or: pairs })
            .toArray();
        const translations = await this.database
            .getCollection<ITranslationDocument>(TRANSLATIONS_COLLECTION)
            .find({ language, $or: pairs })
            .toArray();

        const keyById = new Map(keys.map(key => [joinKeyId(key.namespace, key.key), key]));
        const translationById = new Map(translations.map(translation => [joinKeyId(translation.namespace, translation.key), translation]));

        const items: ISuggestionItem[] = [];
        for (const ref of refs) {
            const id = joinKeyId(ref.namespace, ref.key);
            const key = keyById.get(id);
            if (key) {
                const translation = translationById.get(id);
                items.push({
                    namespace: key.namespace,
                    key: key.key,
                    source: key.source,
                    // Only a stale translation is passed along. A current one
                    // would invite the model to copy it rather than translate.
                    currentTranslation: translation && translation.updatedAt < key.sourceChangedAt ? translation.text : null,
                    routes: key.routes
                });
            }
        }

        if (items.length === 0) {
            throw new LocalizationNotFoundError('None of the requested keys exist');
        }
        return items;
    }

    /**
     * Confirm the target language is configured.
     *
     * @param code - Candidate code from the request.
     * @returns The stored language.
     */
    private async requireLanguage(code: unknown): Promise<ILanguageDocument> {
        if (typeof code !== 'string' || code === '') {
            throw new LocalizationValidationError('Invalid language: a language code is required');
        }
        const language = await this.database.getCollection<ILanguageDocument>(LANGUAGES_COLLECTION).findOne({ code });
        if (!language) {
            throw new LocalizationNotFoundError(`Language "${code}" not found`);
        }
        return language;
    }

    /**
     * Validate the requested keys. Each value goes into a query filter, so
     * anything other than a plain string matching the key rules is refused
     * before it can be read as a Mongo operator.
     *
     * @param keys - Candidate list from the request.
     * @returns De-duplicated namespace and key pairs, in request order.
     */
    private requireKeyRefs(keys: unknown): Array<{ namespace: string; key: string }> {
        if (!Array.isArray(keys) || keys.length === 0 || keys.length > MAX_TRANSLATION_SUGGESTION_KEYS) {
            throw new LocalizationValidationError(`Invalid keys: send 1–${MAX_TRANSLATION_SUGGESTION_KEYS} keys`);
        }
        const seen = new Set<string>();
        const refs: Array<{ namespace: string; key: string }> = [];
        for (const entry of keys) {
            const namespace = typeof entry?.namespace === 'string' ? entry.namespace : '';
            const key = typeof entry?.key === 'string' ? entry.key : '';
            if (namespace === '' || !KEY_PATTERN.test(key)) {
                throw new LocalizationValidationError('Invalid keys: each entry needs a namespace and a key');
            }
            const id = joinKeyId(namespace, key);
            if (!seen.has(id)) {
                seen.add(id);
                refs.push({ namespace, key });
            }
        }
        return refs;
    }
}

/**
 * Size the output budget to the batch, so a single key does not reserve the
 * same budget as a full page. English runs about four characters per token;
 * allowing one token per source character leaves room for languages that need
 * more tokens than English for the same text.
 *
 * @param items - Keys in the batch.
 * @returns Output tokens to allow.
 */
function estimateOutputTokens(items: ISuggestionItem[]): number {
    const sourceCharacters = items.reduce((total, item) => total + item.source.length, 0);
    return Math.min(MAX_OUTPUT_TOKENS, BASE_OUTPUT_TOKENS + items.length * PER_KEY_OUTPUT_TOKENS + sourceCharacters);
}
