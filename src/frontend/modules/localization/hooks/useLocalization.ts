'use client';

/**
 * @fileoverview Hook returning the whole localization seed.
 *
 * @module modules/localization/hooks/useLocalization
 */

import { useContext } from 'react';
import { LocalizationContext } from '../components/LocalizationProvider';
import type { ILocalizationSeed } from '../types';

/**
 * Read the page's language together with the public snapshot of live
 * languages and routes. Components that only render text want
 * `useTranslation` instead; this is for components that reason about other
 * languages, such as the language switcher.
 *
 * @returns The seed the root layout provided.
 */
export function useLocalization(): ILocalizationSeed {
    return useContext(LocalizationContext);
}
