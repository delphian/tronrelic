/**
 * @fileoverview Admin API client for content translations.
 *
 * Thin fetch wrappers over `/api/admin/content/*`, the core routes that manage
 * translations for every translatable content type. Same-origin calls carry
 * the Better Auth session cookie, which the backend's `requireAdmin`
 * middleware reads, so there is no token handling here. Every function throws
 * on a non-2xx response with the server's message, so the caller can show it.
 */

import type {
    IContentTranslation,
    IContentTranslationOverview,
    IContentTranslationSettings,
    IContentTranslationSuggestion,
    IContentTranslationWrite
} from '@/types';

/** Base path for every content admin endpoint. */
const BASE = '/api/admin/content';

/**
 * Send one request and parse the reply, throwing the server's message on a
 * non-2xx status.
 *
 * @param method - HTTP method.
 * @param path - Path below `/api/admin/content`.
 * @param what - A short verb phrase naming the action, for the fallback message.
 * @param body - JSON body, when the request has one.
 * @returns The parsed reply, or undefined for a 204.
 */
async function send<T>(method: string, path: string, what: string, body?: unknown): Promise<T> {
    const response = await fetch(`${BASE}${path}`, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || data.error || `Failed to ${what} (HTTP ${response.status})`);
    }

    return (response.status === 204 ? undefined : await response.json()) as T;
}

/**
 * Build the path of one item's translations.
 *
 * @param typeId - The managed content type, such as `core:page`.
 * @param id - Core content id of the item.
 * @returns The path below `/api/admin/content`.
 */
function itemPath(typeId: string, id: string): string {
    return `/${encodeURIComponent(typeId)}/${encodeURIComponent(id)}/translations`;
}

/**
 * Load an item's English source and every translation of it.
 *
 * @param typeId - The managed content type.
 * @param id - Core content id of the item.
 * @returns The source and the translations.
 */
export async function getTranslationOverview(typeId: string, id: string): Promise<IContentTranslationOverview> {
    return send<IContentTranslationOverview>('GET', itemPath(typeId, id), 'load translations');
}

/**
 * Create or replace one translation.
 *
 * @param typeId - The managed content type.
 * @param id - Core content id of the item.
 * @param language - Language code of the translation.
 * @param input - The translated values and the published switch.
 * @returns The saved translation.
 */
export async function saveTranslation(
    typeId: string,
    id: string,
    language: string,
    input: IContentTranslationWrite
): Promise<IContentTranslation> {
    const body = await send<{ translation: IContentTranslation }>(
        'PUT',
        `${itemPath(typeId, id)}/${encodeURIComponent(language)}`,
        'save translation',
        input
    );

    return body.translation;
}

/**
 * Soft-delete one translation.
 *
 * @param typeId - The managed content type.
 * @param id - Core content id of the item.
 * @param language - Language code of the translation.
 */
export async function deleteTranslation(typeId: string, id: string, language: string): Promise<void> {
    await send<void>('DELETE', `${itemPath(typeId, id)}/${encodeURIComponent(language)}`, 'delete translation');

    return;
}

/**
 * Restore one soft-deleted translation.
 *
 * @param typeId - The managed content type.
 * @param id - Core content id of the item.
 * @param language - Language code of the translation.
 * @returns The restored translation.
 */
export async function restoreTranslation(typeId: string, id: string, language: string): Promise<IContentTranslation> {
    const body = await send<{ translation: IContentTranslation }>(
        'POST',
        `${itemPath(typeId, id)}/${encodeURIComponent(language)}/restore`,
        'restore translation'
    );

    return body.translation;
}

/**
 * Ask the AI model for a translation. Nothing is saved.
 *
 * @param typeId - The managed content type.
 * @param id - Core content id of the item.
 * @param language - Target language code.
 * @returns The suggested values, the model's notes, and the cost.
 */
export async function suggestTranslation(typeId: string, id: string, language: string): Promise<IContentTranslationSuggestion> {
    return send<IContentTranslationSuggestion>(
        'POST',
        `${itemPath(typeId, id)}/${encodeURIComponent(language)}/suggest`,
        'suggest a translation'
    );
}

/**
 * Read the AI settings for translation suggestions.
 *
 * @returns The settings.
 */
export async function getTranslationSettings(): Promise<IContentTranslationSettings> {
    const body = await send<{ settings: IContentTranslationSettings }>('GET', '/translation-settings', 'load translation settings');

    return body.settings;
}

/**
 * Change the AI settings for translation suggestions.
 *
 * @param updates - The fields to change.
 * @returns The settings after the change.
 */
export async function updateTranslationSettings(
    updates: Partial<Omit<IContentTranslationSettings, 'updatedAt'>>
): Promise<IContentTranslationSettings> {
    const body = await send<{ settings: IContentTranslationSettings }>(
        'PATCH',
        '/translation-settings',
        'save translation settings',
        updates
    );

    return body.settings;
}
