/**
 * @fileoverview Resolve everything a server render needs to translate text.
 *
 * The root layout and any server code that translates text, such as a page's
 * `generateMetadata`, need the same four things: the language the middleware
 * routed the request to, that language's script direction, the unprefixed
 * path, and the translation catalog. Building them in one place keeps the
 * layout and the metadata of a page from disagreeing about the language.
 *
 * Both reads go through the Next.js fetch cache, so calling this from the
 * layout and from `generateMetadata` in the same request costs at most one
 * backend call per minute for each.
 *
 * Server-only: exposed through `modules/localization/server`.
 *
 * @module modules/localization/lib/fetchLocalizationSeed
 */

import type { LanguageDirection } from '@/types';
import type { ILocalizationSeed } from '../types';
import { fetchLocalizationConfig, fetchTranslationCatalog } from './fetchLocalization';
import { resolveRequestLanguage } from './resolveRequestLanguage';

/** Direction used when the language is English or not in the snapshot. */
const DEFAULT_DIRECTION: LanguageDirection = 'ltr';

/**
 * Build the localization seed for the current request.
 *
 * Resolves the routed language from the `[lang]` parameter and the
 * middleware's header, then reads the public snapshot and that language's
 * catalog in parallel.
 *
 * @param lang - The `[lang]` route parameter of the request being rendered.
 * @returns The seed that `LocalizationProvider` and `createTranslator` read.
 */
export async function fetchLocalizationSeed(lang: string): Promise<ILocalizationSeed> {
    const { language, path } = await resolveRequestLanguage(lang);
    const [config, catalog] = await Promise.all([
        fetchLocalizationConfig(),
        fetchTranslationCatalog(language)
    ]);
    const direction = config.languages.find(entry => entry.code === language)?.direction ?? DEFAULT_DIRECTION;

    return { language, direction, path, config, catalog };
}
