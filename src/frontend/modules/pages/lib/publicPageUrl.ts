/**
 * @fileoverview Builds the URL of a public CMS page endpoint in one language.
 */

import { DEFAULT_LANGUAGE } from '@/types';

/**
 * Build the URL of a public CMS page endpoint in the language being rendered.
 *
 * A translated request adds `?language=`, and the backend then answers with
 * that page's translation or a 404. It never falls back to the English body,
 * so a translated address cannot serve English text under a translated
 * `<html lang>`.
 *
 * @param apiUrl - Server-side API base URL.
 * @param slug - The page path, such as `/about`.
 * @param language - The language being rendered.
 * @param suffix - Path after the slug, such as `/render`.
 * @returns The endpoint URL to fetch.
 */
export function publicPageUrl(apiUrl: string, slug: string, language: string, suffix = ''): string {
    const query = language === DEFAULT_LANGUAGE ? '' : `?language=${encodeURIComponent(language)}`;
    return `${apiUrl}/pages/${encodeURIComponent(slug)}${suffix}${query}`;
}
