'use client';

/**
 * @fileoverview Hook returning a function that points links at the page's language.
 *
 * @module modules/localization/hooks/useLocalizedHref
 */

import { useCallback, useContext } from 'react';
import { localizeHref } from '@/types';
import { LocalizationContext } from '../components/LocalizationProvider';

/**
 * Get a function that rewrites a stored, unprefixed link for the current page.
 *
 * On a translated page, a link whose target is published in the same language
 * gains the language prefix, so following it keeps the visitor in that
 * language; every other link is returned unchanged. On English pages the
 * function returns its input, so components can call it unconditionally.
 * The server and the browser read the same seed, so both render the same
 * `href` and hydration matches.
 *
 * @returns A function from a stored link to the link to render.
 */
export function useLocalizedHref(): (href: string) => string {
    const { language, config } = useContext(LocalizationContext);

    /**
     * Localize one link against the page's language and snapshot.
     *
     * @param href - The link as stored, such as a menu item's URL.
     * @returns The link to render.
     */
    const localize = useCallback((href: string): string => localizeHref(href, language, config), [language, config]);

    return localize;
}
