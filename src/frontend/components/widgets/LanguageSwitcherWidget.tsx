'use client';

/**
 * @fileoverview Core "language switcher" widget renderer.
 *
 * Renders the `core:language-switcher` widget type. The widget's `data` carries
 * only the operator's label choice; which languages to offer comes from the
 * localization snapshot the root layout seeds, because that list depends on the
 * page and must stay right after client-side navigation, when no widget data
 * is fetched again. On a page that exists only in English it renders nothing,
 * so placing it changes nothing until a route is published in another language.
 *
 * @module frontend/components/widgets/LanguageSwitcherWidget
 */

import type { IWidgetComponentProps } from '@/types';
// Imported from the component folder rather than the module barrel: this file
// renders in the layout's widget zones, and the barrel also exports the admin
// tabs, whose code and stylesheets the layout bundle must not carry.
import { LanguageSwitcher } from '../../modules/localization/components/LanguageSwitcher';

/**
 * SSR payload shape produced by the `core:language-switcher` data fetcher.
 * Mirrors `ILanguageSwitcherWidgetData` in `backend/modules/widgets/
 * widget-types/core-widget-types.ts`; redeclared because the frontend cannot
 * import backend module internals.
 */
interface ILanguageSwitcherData {
    /** Show each language by its own name or by its short code. */
    display?: 'native' | 'code';
}

/**
 * Language switcher widget.
 *
 * @param props - Widget component props; only the SSR `data` is read.
 * @returns The switcher, or nothing on an English-only page.
 */
export function LanguageSwitcherWidget({ data }: IWidgetComponentProps) {
    const { display = 'native' } = (data ?? {}) as ILanguageSwitcherData;
    return <LanguageSwitcher display={display} />;
}
