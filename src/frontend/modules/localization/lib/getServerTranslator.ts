/**
 * @fileoverview Translator for server code that cannot call a React hook.
 *
 * `useTranslation` only works inside a component. A page's `generateMetadata`
 * runs outside any component, so without this helper a translated page would
 * still send search engines an English title and description. This builds
 * the same translator the hook returns, from the same seed, so text rendered
 * in metadata is looked up and reported to `/system/localization` exactly as
 * text rendered in the page body is.
 *
 * Server-only: exposed through `modules/localization/server`.
 *
 * @module modules/localization/lib/getServerTranslator
 */

import type { ITranslator } from '@/types';
import { createTranslator } from './createTranslator';
import { fetchLocalizationSeed } from './fetchLocalizationSeed';
import { CORE_TRANSLATION_NAMESPACE } from './CORE_TRANSLATION_NAMESPACE';

/**
 * Get a translator for the language the current request was routed to.
 *
 * Takes the route params promise Next.js hands `generateMetadata` and server
 * components, so a caller passes it straight through.
 *
 * @param params - The route params promise carrying the `[lang]` segment.
 * @param namespace - Owner of the keys; core code leaves the default `core`.
 * @returns The translator, whose `language` is also the value to pass to `buildMetadata`.
 */
export async function getServerTranslator(
    params: Promise<{ lang: string }>,
    namespace: string = CORE_TRANSLATION_NAMESPACE
): Promise<ITranslator> {
    const { lang } = await params;
    const seed = await fetchLocalizationSeed(lang);

    return createTranslator(seed, namespace);
}
