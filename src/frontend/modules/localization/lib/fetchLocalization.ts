/**
 * @fileoverview Server-side reads of the localization snapshot and catalogs.
 *
 * The root layout needs both on every request, so both use the Next.js fetch
 * cache with a 60-second window instead of calling the backend each time. That
 * matches the backend's own `Cache-Control` and the middleware's refresh
 * interval, so an administrator's change reaches every part of the frontend
 * within about a minute.
 *
 * Any failure falls back to "English only". That is the state the site was in
 * before localization existed, so a backend outage can never leave a page
 * half-translated or unrenderable.
 *
 * Server-only: exposed through `modules/localization/server`.
 *
 * @module modules/localization/lib/fetchLocalization
 */

import type { ILocalizationPublicConfig, ITranslationCatalog } from '@/types';
import { DEFAULT_LANGUAGE } from '@/types';
import { getServerSideApiUrl } from '../../../lib/api-url';

/** Seconds the Next.js fetch cache keeps a response. */
const REVALIDATE_SECONDS = 60;

/** How long a read may take before the page renders English instead. */
const FETCH_TIMEOUT_MS = 3000;

/** The snapshot of a site with no language enabled. */
export const ENGLISH_ONLY_CONFIG: ILocalizationPublicConfig = { defaultLanguage: DEFAULT_LANGUAGE, languages: [], routes: [] };

/**
 * Read the live languages and published routes.
 *
 * @returns The public snapshot, or the English-only snapshot on any failure.
 */
export async function fetchLocalizationConfig(): Promise<ILocalizationPublicConfig> {
    let config = ENGLISH_ONLY_CONFIG;
    try {
        const response = await fetch(`${getServerSideApiUrl()}/api/localization/config`, {
            next: { revalidate: REVALIDATE_SECONDS },
            signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
        });
        if (response.ok) {
            const body = await response.json() as Partial<ILocalizationPublicConfig>;
            config = {
                defaultLanguage: DEFAULT_LANGUAGE,
                languages: Array.isArray(body.languages) ? body.languages : [],
                routes: Array.isArray(body.routes) ? body.routes : []
            };
        } else {
            console.error('Failed to fetch localization config:', response.status);
        }
    } catch (error) {
        console.error('Error fetching localization config:', error);
    }
    return config;
}

/**
 * Read every translation for one language.
 *
 * English is never translated, so it returns an empty catalog without a
 * request.
 *
 * @param language - Language the page is rendered in.
 * @returns Translations by namespace and key, empty on any failure.
 */
export async function fetchTranslationCatalog(language: string): Promise<Record<string, Record<string, string>>> {
    let entries: Record<string, Record<string, string>> = {};
    if (language !== DEFAULT_LANGUAGE) {
        try {
            const response = await fetch(`${getServerSideApiUrl()}/api/localization/catalog/${encodeURIComponent(language)}`, {
                next: { revalidate: REVALIDATE_SECONDS },
                signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
            });
            if (response.ok) {
                const body = await response.json() as Partial<ITranslationCatalog>;
                entries = body.entries ?? {};
            } else {
                console.error('Failed to fetch translation catalog:', language, response.status);
            }
        } catch (error) {
            console.error('Error fetching translation catalog:', language, error);
        }
    }
    return entries;
}
