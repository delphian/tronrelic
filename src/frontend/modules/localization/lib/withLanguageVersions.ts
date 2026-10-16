/**
 * @fileoverview Expand one sitemap entry into an entry per language version.
 *
 * Google's rule for listing translations in a sitemap is that every language
 * version gets its own `<url>` element, and each of those lists every version,
 * itself included. Listing only the English address, with the translations as
 * alternates inside it, leaves the translated pages without an entry of their
 * own. The alternates come from `buildLanguageAlternates`, the same helper that
 * writes the `hreflang` links in each page's `<head>`, so the sitemap and the
 * pages always name the same set of versions.
 *
 * @module modules/localization/lib/withLanguageVersions
 */

import type { MetadataRoute } from 'next';
import type { ILocalizationPublicConfig } from '@/types';
import { DEFAULT_LANGUAGE, localizePath } from '@/types';
import { buildLanguageAlternates } from './buildLanguageAlternates';

/** The `hreflang` value naming the fallback version rather than a language. */
const X_DEFAULT = 'x-default';

/**
 * Return the sitemap entries for one path in every language it is published in.
 *
 * A path that exists only in English comes back as the entry it was given,
 * unchanged. A translated path comes back as the English entry plus one entry
 * per published language, all carrying the same alternates. A translated
 * address already listed by another source, such as a CMS page whose slug
 * happens to start with `/zh/`, is skipped so no URL appears twice.
 *
 * @param config - The public localization snapshot; lists enabled languages only.
 * @param siteUrl - Public site origin, e.g. `https://tronrelic.com`.
 * @param path - Unprefixed path of the entry.
 * @param entry - The English entry, carrying its own URL, dates, and priority.
 * @param seenPaths - Paths already in the sitemap; translated paths are added to it.
 * @returns The entries to add to the sitemap.
 */
export function withLanguageVersions(
    config: ILocalizationPublicConfig,
    siteUrl: string,
    path: string,
    entry: MetadataRoute.Sitemap[number],
    seenPaths: Set<string>
): MetadataRoute.Sitemap {
    const alternates = buildLanguageAlternates(config, path, siteUrl);
    let entries: MetadataRoute.Sitemap = [entry];
    if (alternates.length > 0) {
        const languages = Object.fromEntries(alternates.map(alternate => [alternate.hrefLang, alternate.href]));
        entries = [{ ...entry, alternates: { languages } }];
        for (const alternate of alternates) {
            if (alternate.hrefLang !== DEFAULT_LANGUAGE && alternate.hrefLang !== X_DEFAULT) {
                const localizedPath = localizePath(path, alternate.hrefLang);
                if (!seenPaths.has(localizedPath)) {
                    seenPaths.add(localizedPath);
                    entries.push({ ...entry, url: alternate.href, alternates: { languages } });
                }
            }
        }
    }
    return entries;
}
