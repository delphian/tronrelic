/**
 * @fileoverview Build the `t` function components render text through.
 *
 * Kept free of React so the same lookup runs in the provider, in tests, and in
 * any non-component code that has a seed in hand.
 *
 * @module modules/localization/lib/createTranslator
 */

import type { ITranslator, TranslationParams } from '@/types';
import { DEFAULT_LANGUAGE, interpolateTranslation, matchRoutePattern } from '@/types';
import type { ILocalizationSeed } from '../types';
import { reportTranslationObservation } from './observationReporter';

/**
 * Create a translator bound to one namespace.
 *
 * The returned `t` looks the key up in the seed's catalog, falls back to the
 * English text, and fills placeholders. While the server renders, each lookup
 * is also reported so the key reaches the admin page, flagged as missing when
 * a translated page had to fall back to English.
 *
 * @param seed - The page's language, path, and catalog.
 * @param namespace - `core`, or the id of the plugin rendering the text.
 * @returns A translator for that namespace.
 */
export function createTranslator(seed: ILocalizationSeed, namespace: string): ITranslator {
    const entries = seed.catalog[namespace];
    // Worked out once per translator rather than per lookup, since the page
    // path is fixed for the whole render.
    const routePatterns = seed.config.routes
        .filter(route => matchRoutePattern(route.pattern, seed.path))
        .map(route => route.pattern);

    /**
     * Look a key up and return the text to render.
     *
     * @param key - Key within the namespace.
     * @param fallback - The English text.
     * @param params - Values for `{name}` placeholders.
     * @returns The translated or English text with placeholders filled.
     */
    const t = (key: string, fallback: string, params?: TranslationParams): string => {
        const translated = entries?.[key];
        const isMissing = translated === undefined && seed.language !== DEFAULT_LANGUAGE;
        reportTranslationObservation({
            namespace,
            key,
            source: fallback,
            path: seed.path,
            ...(isMissing ? { missingIn: seed.language } : {})
        }, routePatterns);
        return interpolateTranslation(translated ?? fallback, params);
    };

    return { language: seed.language, direction: seed.direction, t };
}
