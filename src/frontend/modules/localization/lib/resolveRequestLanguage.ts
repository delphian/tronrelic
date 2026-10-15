/**
 * @fileoverview Work out, inside a server component, which language and path
 * the current request was routed to.
 *
 * Every page lives under the `[lang]` folder, but only requests the middleware
 * routed carry a trustworthy language: it rewrites `/markets` to `/en/markets`
 * and sets the language header to match. A request the middleware deliberately
 * left alone, such as a missing file under `/images/`, still lands in the
 * `[lang]` folder with whatever its first segment was as the "language". This
 * helper tells the two apart so the layouts can 404 the second kind.
 *
 * Server-only: exposed through `modules/localization/server`.
 *
 * @module modules/localization/lib/resolveRequestLanguage
 */

import { headers } from 'next/headers';
import { DEFAULT_LANGUAGE } from '@/types';
import { LANGUAGE_REQUEST_HEADER } from './LANGUAGE_REQUEST_HEADER';

/** What a server component knows about the request's language. */
export interface IRequestLanguage {
    /** Language to render, falling back to English when the request was not routed. */
    language: string;

    /** True when the middleware routed the request to this `[lang]` value. */
    routed: boolean;

    /** Unprefixed path of the request, e.g. `/markets` for `/zh/markets`. */
    path: string;
}

/**
 * Compare the `[lang]` route parameter with the language the middleware
 * recorded for this request.
 *
 * @param lang - The `[lang]` route parameter.
 * @returns The language to render, whether the request was routed, and its unprefixed path.
 */
export async function resolveRequestLanguage(lang: string): Promise<IRequestLanguage> {
    const headerList = await headers();
    const routedLanguage = headerList.get(LANGUAGE_REQUEST_HEADER);
    const routed = routedLanguage !== null && routedLanguage === lang;
    return {
        language: routed ? lang : DEFAULT_LANGUAGE,
        routed,
        path: headerList.get('x-pathname') || '/'
    };
}

/**
 * Resolve the language a page's metadata should describe, straight from the
 * route params `generateMetadata` receives.
 *
 * Every page passes the result to `buildMetadata`, which is what makes a
 * Chinese page's canonical URL point at the Chinese address rather than the
 * English one. Pointing it at the English page would tell search engines the
 * Chinese page is a copy to drop.
 *
 * @param params - The route params promise Next.js hands `generateMetadata`.
 * @returns The language to describe, English when the request was not routed.
 */
export async function resolveMetadataLanguage(params: Promise<{ lang: string }>): Promise<string> {
    const { lang } = await params;
    const { language } = await resolveRequestLanguage(lang);
    return language;
}
