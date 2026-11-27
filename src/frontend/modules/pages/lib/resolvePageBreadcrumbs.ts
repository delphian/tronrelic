/**
 * @fileoverview Works out the breadcrumb trail of a CMS page.
 *
 * The trail runs from the home page through each parent address that is a
 * real page, then to the page itself. A parent counts only when it is a menu
 * category, such as `/tools`, because those are the section pages the site
 * actually serves. Building a crumb for every URL segment would link
 * addresses like `/p` that answer 404, which Search Console reports as
 * invalid breadcrumb markup.
 *
 * Names and links follow the page's language: a category is named with the
 * same translation key its landing page uses, and a link points at the
 * translated address only where that address is published.
 *
 * Server-only: exposed through `modules/pages/server`.
 */

import type { IBreadcrumbItem } from '@/types';
import { localizeHref, localizePath } from '@/types';
import { absoluteUrl } from '../../../lib/seo';
import { CATEGORY_MENU_NAMESPACE, fetchMenuCategory } from '../../menu/server';
import type { IMenuCategory } from '../../menu/server';
import { menuTranslationKey } from '../../menu/lib/menuTranslationKey';
import { fetchLocalizationSeed } from '../../localization/server';
import { createTranslator } from '../../localization/lib/createTranslator';
import { CORE_TRANSLATION_NAMESPACE } from '../../localization/lib/CORE_TRANSLATION_NAMESPACE';
import type { ILocalizationSeed } from '../../localization/types';

/** The page fields a trail needs: its address and its name. */
export interface IBreadcrumbPage {
    /** The page's current, unprefixed slug, such as `/tools/whales`. */
    slug: string;
    /** The page title, used as the last step's name. */
    title: string;
}

/**
 * The two lookups the trail depends on, passed in so tests can supply them
 * without a backend.
 */
export interface IPageBreadcrumbDependencies {
    /** Reads the localization snapshot and catalog for a language. */
    fetchSeed: (language: string) => Promise<ILocalizationSeed>;
    /** Reads the menu category served at a URL, or null when there is none. */
    fetchCategory: (url: string) => Promise<IMenuCategory | null>;
}

/** The lookups used outside tests. */
const DEFAULT_DEPENDENCIES: IPageBreadcrumbDependencies = {
    fetchSeed: fetchLocalizationSeed,
    fetchCategory: fetchMenuCategory
};

/**
 * List the parent addresses of a slug, nearest to the root first.
 *
 * @param slug - The page's slug, such as `/tools/stake/advanced`.
 * @returns Each proper prefix path, such as `['/tools', '/tools/stake']`.
 */
function listParentPaths(slug: string): string[] {
    const segments = slug.split('/').filter(Boolean);
    const parents: string[] = [];
    for (let length = 1; length < segments.length; length += 1) {
        parents.push(`/${segments.slice(0, length).join('/')}`);
    }

    return parents;
}

/**
 * Work out the breadcrumb trail of a CMS page in the language being rendered.
 *
 * @param page - The page being rendered, or null when its metadata could not
 *   be read, which yields an empty trail so the page renders without one.
 * @param language - The language being rendered, so names are translated and
 *   links point at that language's addresses where they exist.
 * @param siteUrl - The site's absolute base URL, since structured data needs absolute links.
 * @param dependencies - The localization and menu lookups; tests replace them.
 * @returns The trail from the home page to the page, or an empty list.
 */
export async function resolvePageBreadcrumbs(
    page: IBreadcrumbPage | null,
    language: string,
    siteUrl: string,
    dependencies: IPageBreadcrumbDependencies = DEFAULT_DEPENDENCIES
): Promise<IBreadcrumbItem[]> {
    let trail: IBreadcrumbItem[] = [];
    if (page) {
        const parentPaths = listParentPaths(page.slug);
        const [seed, categories] = await Promise.all([
            dependencies.fetchSeed(language),
            Promise.all(parentPaths.map(path => dependencies.fetchCategory(path)))
        ]);
        const { t } = createTranslator(seed, CORE_TRANSLATION_NAMESPACE);

        /**
         * Make a site path absolute in the trail's language, falling back to
         * the English address where the path is not published in it.
         *
         * @param path - An unprefixed site path, such as `/tools`.
         */
        const linkTo = (path: string): string => absoluteUrl(siteUrl, localizeHref(path, language, seed.config));

        const parents: IBreadcrumbItem[] = [];
        categories.forEach((category, index) => {
            if (category) {
                const path = parentPaths[index];
                const keyNode = { url: category.node.url ?? path, label: category.node.label };
                parents.push({
                    name: t(menuTranslationKey(CATEGORY_MENU_NAMESPACE, keyNode), category.node.label),
                    url: linkTo(path)
                });
            }
        });

        trail = [
            { name: t('breadcrumbs.home', 'Home'), url: linkTo('/') },
            ...parents,
            // The page is being served in this language, so its own address
            // always carries the prefix.
            { name: page.title, url: absoluteUrl(siteUrl, localizePath(page.slug, language)) }
        ];
    }

    return trail;
}
