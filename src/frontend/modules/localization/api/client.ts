/**
 * @fileoverview Admin API client for the localization module.
 *
 * Thin fetch wrappers over `/api/admin/system/localization/*`. Same-origin
 * calls carry the Better Auth session cookie automatically, which the backend
 * `requireAdmin` gate checks, so there is no token handling here. Every
 * function throws with the backend's message on a non-2xx response, so the
 * admin page can show the reason in a toast — for example why a language could
 * not be enabled.
 *
 * @module modules/localization/api/client
 */

import type {
    ILanguage,
    ILanguageSummary,
    ILanguageSwitchStats,
    ILocalizationSettings,
    ILocalizedRoute,
    ILocalizedRouteSummary,
    ITranslation,
    ITranslationKey,
    ITranslationNamespaceSummary,
    ITranslationPage,
    ITranslationSuggestionRequest,
    ITranslationSuggestionResult,
    LanguageDirection,
    TranslationStatus
} from '@/types';

const BASE = '/api/admin/system/localization';

/**
 * Unwrap a response or raise its error message.
 *
 * @param response - The fetch response to check.
 * @param what - Verb phrase naming the failed action for the fallback message.
 * @returns The parsed JSON body, or undefined for an empty 204 response.
 */
async function parse<T>(response: Response, what: string): Promise<T> {
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: `HTTP ${response.status}` }));
        throw new Error(body.error || `Failed to ${what} (HTTP ${response.status})`);
    }
    return (response.status === 204 ? undefined : await response.json()) as T;
}

/**
 * Send a JSON request to the admin API.
 *
 * @param method - HTTP method.
 * @param path - Path below the module's admin base.
 * @param what - Verb phrase for the error message.
 * @param body - JSON body, if any.
 * @returns The parsed response.
 */
async function send<T>(method: string, path: string, what: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
        method,
        credentials: 'include',
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return parse<T>(response, what);
}

/**
 * List configured languages with their translation progress.
 *
 * @returns Languages ordered by code.
 */
export async function listLanguages(): Promise<ILanguageSummary[]> {
    const body = await send<{ languages: ILanguageSummary[] }>('GET', '/languages', 'list languages');
    return body.languages;
}

/**
 * Add a language; it starts disabled.
 *
 * @param input - Code, names, and direction.
 * @returns The stored language.
 */
export async function createLanguage(input: { code: string; name: string; nativeName: string; direction: LanguageDirection }): Promise<ILanguage> {
    const body = await send<{ language: ILanguage }>('POST', '/languages', 'add language', input);
    return body.language;
}

/**
 * Change a language's names, direction, translation prompt, or enabled state.
 *
 * @param code - Language to change.
 * @param patch - Fields to change; an empty `translationPrompt` removes the language's guidance.
 * @returns The updated language.
 */
export async function updateLanguage(
    code: string,
    patch: Partial<{ name: string; nativeName: string; direction: LanguageDirection; translationPrompt: string; enabled: boolean }>
): Promise<ILanguage> {
    const body = await send<{ language: ILanguage }>('PATCH', `/languages/${encodeURIComponent(code)}`, 'update language', patch);
    return body.language;
}

/**
 * Remove a language and every translation into it.
 *
 * @param code - Language to remove.
 */
export async function deleteLanguage(code: string): Promise<void> {
    await send<void>('DELETE', `/languages/${encodeURIComponent(code)}`, 'delete language');
}

/**
 * List published routes with their translation gaps.
 *
 * @returns Routes ordered by pattern.
 */
export async function listRoutes(): Promise<ILocalizedRouteSummary[]> {
    const body = await send<{ routes: ILocalizedRouteSummary[] }>('GET', '/routes', 'list routes');
    return body.routes;
}

/**
 * Publish a route pattern in a set of languages.
 *
 * @param input - Pattern and languages.
 * @returns The stored route.
 */
export async function createRoute(input: { pattern: string; languages: string[] }): Promise<ILocalizedRoute> {
    const body = await send<{ route: ILocalizedRoute }>('POST', '/routes', 'add route', input);
    return body.route;
}

/**
 * Change the languages a route is published in.
 *
 * @param id - Route identifier.
 * @param patch - New pattern, languages, or both.
 * @returns The updated route.
 */
export async function updateRoute(id: string, patch: Partial<{ pattern: string; languages: string[] }>): Promise<ILocalizedRoute> {
    const body = await send<{ route: ILocalizedRoute }>('PATCH', `/routes/${encodeURIComponent(id)}`, 'update route', patch);
    return body.route;
}

/**
 * Stop publishing a route in any language.
 *
 * @param id - Route identifier.
 */
export async function deleteRoute(id: string): Promise<void> {
    await send<void>('DELETE', `/routes/${encodeURIComponent(id)}`, 'delete route');
}

/**
 * List namespaces that hold keys.
 *
 * @returns Namespaces with key counts.
 */
export async function listNamespaces(): Promise<ITranslationNamespaceSummary[]> {
    const body = await send<{ namespaces: ITranslationNamespaceSummary[] }>('GET', '/namespaces', 'list namespaces');
    return body.namespaces;
}

/** Filter for the translation listing. */
export interface ITranslationQuery {
    /** Language whose translations to show. */
    language: string;
    /** Restrict to one namespace. */
    namespace?: string;
    /** Restrict to one status. */
    status?: TranslationStatus;
    /** Text matched against key and English source. */
    search?: string;
    /** Restrict to keys seen on paths this route pattern covers. */
    route?: string;
    /** Page size. */
    limit: number;
    /** Rows to skip. */
    offset: number;
}

/**
 * List keys with their translation in one language.
 *
 * @param query - Language, filters, and page.
 * @returns One page of rows and the total.
 */
export async function listTranslations(query: ITranslationQuery): Promise<ITranslationPage> {
    const params = new URLSearchParams();
    for (const [name, value] of Object.entries(query)) {
        if (value !== undefined && value !== '') {
            params.set(name, String(value));
        }
    }
    return send<ITranslationPage>('GET', `/translations?${params.toString()}`, 'list translations');
}

/**
 * Save one translation.
 *
 * @param input - Key, language, and text.
 * @returns The stored translation.
 */
export async function saveTranslation(input: { namespace: string; key: string; language: string; text: string }): Promise<ITranslation> {
    const body = await send<{ translation: ITranslation }>('PUT', '/translations', 'save translation', input);
    return body.translation;
}

/**
 * Save several translations into one language in a single request. The
 * Translations tab uses this for Save all, because one request per row would
 * use up the admin rate limit partway through a page. The backend checks every
 * entry before writing any, so a bad entry saves nothing.
 *
 * @param input - The language and the key and text of each entry.
 * @returns The stored translations, in the order they were sent.
 */
export async function saveTranslations(input: {
    language: string;
    translations: Array<{ namespace: string; key: string; text: string }>;
}): Promise<ITranslation[]> {
    const body = await send<{ translations: ITranslation[] }>('PUT', '/translations/batch', 'save translations', input);
    return body.translations;
}

/**
 * Remove one translation so the English text shows again.
 *
 * @param namespace - Owner of the key.
 * @param key - Key within the namespace.
 * @param language - Language to remove.
 */
export async function deleteTranslation(namespace: string, key: string, language: string): Promise<void> {
    const params = new URLSearchParams({ namespace, key, language });
    await send<void>('DELETE', `/translations?${params.toString()}`, 'delete translation');
}

/**
 * Add a key by hand.
 *
 * @param input - Namespace, key, and English source.
 * @returns The stored key.
 */
export async function createKey(input: { namespace: string; key: string; source: string }): Promise<ITranslationKey> {
    const body = await send<{ key: ITranslationKey }>('POST', '/keys', 'add key', input);
    return body.key;
}

/**
 * Remove a key and every translation of it.
 *
 * @param namespace - Owner of the key.
 * @param key - Key within the namespace.
 */
export async function deleteKey(namespace: string, key: string): Promise<void> {
    const params = new URLSearchParams({ namespace, key });
    await send<void>('DELETE', `/keys?${params.toString()}`, 'delete key');
}

/**
 * Read the AI translation settings: system prompt, provider, and model.
 *
 * @returns The current settings, with defaults for anything never saved.
 */
export async function getLocalizationSettings(): Promise<ILocalizationSettings> {
    const body = await send<{ settings: ILocalizationSettings }>('GET', '/settings', 'load settings');
    return body.settings;
}

/**
 * Change the AI translation settings.
 *
 * @param patch - Fields to change; a null provider or model means "automatic".
 * @returns The settings after the change.
 */
export async function updateLocalizationSettings(
    patch: Partial<{ systemPrompt: string; providerId: string | null; model: string | null }>
): Promise<ILocalizationSettings> {
    const body = await send<{ settings: ILocalizationSettings }>('PATCH', '/settings', 'save settings', patch);
    return body.settings;
}

/**
 * Ask the AI model to translate keys. Nothing is saved; the caller places the
 * suggested text in its editors for the administrator to review.
 *
 * @param request - Target language and the keys to translate.
 * @returns Suggested text per key, the model's notes, and the cost of the run.
 */
export async function suggestTranslations(request: ITranslationSuggestionRequest): Promise<ITranslationSuggestionResult> {
    return send<ITranslationSuggestionResult>('POST', '/translation-suggestions', 'suggest translations', request);
}

/**
 * Read how often visitors used the language switcher, for the Switches tab.
 *
 * @param days - Trailing window in whole UTC days, today included. The
 *   backend clamps it to between 1 and 365.
 * @returns Totals for the window by day, by direction, and by route.
 */
export async function getLanguageSwitchStats(days: number): Promise<ILanguageSwitchStats> {
    return send<ILanguageSwitchStats>('GET', `/switches?days=${encodeURIComponent(String(days))}`, 'load language switches');
}
