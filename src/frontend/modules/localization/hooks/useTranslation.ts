'use client';

/**
 * @fileoverview Hook returning the translator for one namespace.
 *
 * @module modules/localization/hooks/useTranslation
 */

import { useContext, useMemo } from 'react';
import type { ITranslator } from '@/types';
import { LocalizationContext } from '../components/LocalizationProvider';
import { createTranslator } from '../lib/createTranslator';
import { CORE_TRANSLATION_NAMESPACE } from '../lib/CORE_TRANSLATION_NAMESPACE';

/**
 * Get a `t` function for the current page's language.
 *
 * Core components call it with no argument and their keys land in the `core`
 * namespace. The plugin context calls it with the plugin's id, so plugin keys
 * never collide with core's or with another plugin's.
 *
 * @param namespace - Owner of the keys this component renders.
 * @returns The translator for that namespace.
 */
export function useTranslation(namespace: string = CORE_TRANSLATION_NAMESPACE): ITranslator {
    const seed = useContext(LocalizationContext);
    return useMemo(() => createTranslator(seed, namespace), [seed, namespace]);
}
