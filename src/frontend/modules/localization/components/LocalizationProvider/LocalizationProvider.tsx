'use client';

/**
 * @fileoverview React context carrying the page's language and translations.
 *
 * The root layout resolves the language, the public snapshot, and the catalog
 * on the server and passes them here once. Every component below reads them
 * through `useTranslation` or `useLocalization`, so no component fetches
 * translations itself and the server and browser render the same text.
 *
 * @module modules/localization/components/LocalizationProvider
 */

import { createContext, type ReactNode } from 'react';
import { DEFAULT_LANGUAGE } from '@/types';
import type { ILocalizationSeed } from '../../types';

/**
 * The seed used when no provider is mounted, such as in an isolated test or
 * the global error page. It renders English with nothing published, which is
 * exactly how the site behaved before localization existed.
 */
export const ENGLISH_SEED: ILocalizationSeed = {
    language: DEFAULT_LANGUAGE,
    direction: 'ltr',
    path: '/',
    config: { defaultLanguage: DEFAULT_LANGUAGE, languages: [], routes: [] },
    catalog: {}
};

/** Context holding the current page's localization seed. */
export const LocalizationContext = createContext<ILocalizationSeed>(ENGLISH_SEED);

/** Props for {@link LocalizationProvider}. */
interface ILocalizationProviderProps {
    /** Language, snapshot, and catalog the root layout resolved for this request. */
    seed: ILocalizationSeed;
    /** The page subtree. */
    children: ReactNode;
}

/**
 * Make the page's localization seed available to every component below.
 *
 * @param props - The seed and the subtree.
 * @returns The subtree inside the context provider.
 */
export function LocalizationProvider({ seed, children }: ILocalizationProviderProps) {
    return <LocalizationContext.Provider value={seed}>{children}</LocalizationContext.Provider>;
}
