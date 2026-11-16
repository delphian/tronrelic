'use client';

/**
 * @fileoverview Read the interface density of the page currently shown.
 *
 * The root layout does not render again when a visitor moves between pages
 * without a full reload, so a density decided on the server would stay on
 * screen after a menu click from a public page to an admin page. This hook
 * reads the current path in the browser and on the server, so the first
 * render and every later navigation agree.
 */

import { usePathname } from 'next/navigation';
import { resolveLocalizedPath } from '@/types';
// Imported directly rather than through the localization module's barrel:
// this hook runs on every page, and the barrel also exports the admin tabs,
// whose styles would join the layout bundle.
import { useLocalization } from '../../../modules/localization/hooks/useLocalization';
import type { DensityStep } from './DensityStep';
import { resolveRouteDensity } from './resolveRouteDensity';

/**
 * Return the density the current page renders at.
 *
 * The language prefix is removed with the same `resolveLocalizedPath` rule
 * the middleware applies, so a translated address resolves like its English
 * one and the server render matches the first browser render.
 *
 * @returns The density step for the current page, or `undefined` when the
 *   page keeps the density it inherits.
 */
export function useRouteDensity(): DensityStep | undefined {
    const pathname = usePathname() ?? '/';
    const { config } = useLocalization();
    const route = resolveLocalizedPath(pathname, config).path;
    return resolveRouteDensity(route);
}
