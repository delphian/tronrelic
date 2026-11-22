/**
 * @fileoverview Stake calculator tool route.
 *
 * This address is the default address of the stake calculator CMS page an
 * admin creates from `/system/tools`. Once that page is published here in the
 * visitor's language, this route serves it. If an admin later moves the page
 * to another address, the CMS rules apply: the old address redirects to the
 * new one, exactly as the catch-all route does for any renamed page.
 *
 * When no CMS page answers at this address in the visitor's language — before
 * one is created or approved, after one is deleted, or in a language it has no
 * published translation into — the built-in calculator page is served, so the
 * address never returns a 404. It is also served when the backend cannot be
 * reached, since the calculator itself needs no stored content.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { localizePath, STAKE_CALCULATOR_PATH } from '@/types';
import { buildMetadata } from '../../../../../../lib/seo';
import { getServerConfig } from '../../../../../../lib/serverConfig';
import { translateKeywords } from '../../../../../../lib/translateKeywords';
import { getServerTranslator, resolveMetadataLanguage } from '../../../../../../modules/localization/server';
import { CmsPageArticle } from '../../../../../../modules/pages';
import type { IPublicPageRenderResponse, IPublicPageResponse } from '../../../../../../modules/pages';
import { fetchPublicPageMetadata, fetchPublicPageRender } from '../../../../../../modules/pages/server';
import { StakeCalculator } from '../../../../../../modules/tools';

/** Route props; `params.lang` is the language the middleware routed to. */
interface IStakeCalculatorPageProps {
    params: Promise<{ lang: string }>;
}

/**
 * Read the metadata of the CMS page answering at this address, including a
 * page that has moved away and only redirects from here.
 *
 * A backend error yields null, so an outage falls back to the built-in
 * calculator rather than an error page.
 *
 * @param language - The language being rendered.
 * @returns The page's metadata, or null when no page answers here.
 */
async function readPageMetadata(language: string): Promise<IPublicPageResponse | null> {
    let data: IPublicPageResponse | null = null;
    try {
        data = await fetchPublicPageMetadata(STAKE_CALCULATOR_PATH, language);
    } catch (error) {
        console.error('Failed to read the stake calculator CMS page metadata:', error);
    }

    return data;
}

/**
 * Read the rendered CMS page answering at this address, including a page that
 * has moved away and only redirects from here. Handles a backend error the
 * same way as `readPageMetadata`.
 *
 * @param language - The language being rendered.
 * @returns The rendered page, or null when no page answers here.
 */
async function readPageRender(language: string): Promise<IPublicPageRenderResponse | null> {
    let render: IPublicPageRenderResponse | null = null;
    try {
        render = await fetchPublicPageRender(STAKE_CALCULATOR_PATH, language);
    } catch (error) {
        console.error('Failed to read the stake calculator CMS page:', error);
    }

    return render;
}

/**
 * Generate SEO metadata: the CMS page's own title, description, and keywords
 * when it is served here, nothing when it has moved (the body redirects), and
 * the built-in metadata targeting TRON staking and energy yield keywords when
 * no CMS page answers.
 *
 * @param props - Route props; `params.lang` selects the language the canonical URL uses.
 * @returns The page's metadata.
 */
export async function generateMetadata({ params }: IStakeCalculatorPageProps): Promise<Metadata> {
    const [{ siteUrl }, { t, language }] = await Promise.all([getServerConfig(), getServerTranslator(params)]);
    const data = await readPageMetadata(language);

    let metadata: Metadata;
    if (data && data.page.slug !== STAKE_CALCULATOR_PATH) {
        metadata = {};
    } else if (data) {
        metadata = buildMetadata({
            siteUrl,
            language,
            title: data.page.title,
            description: data.page.description,
            path: STAKE_CALCULATOR_PATH,
            image: data.page.ogImage,
            keywords: data.page.keywords
        });
    } else {
        metadata = buildMetadata({
            siteUrl,
            language,
            title: t('tools.stakeCalculator.meta.title', 'TRON Stake Calculator | TRX Staking Energy & Bandwidth Yield'),
            description: t(
                'tools.stakeCalculator.meta.description',
                'Calculate energy and bandwidth yield from staking TRX on the TRON network. Compare staking returns against renting energy from delegation markets.'
            ),
            path: STAKE_CALCULATOR_PATH,
            keywords: translateKeywords(t, 'tools.stakeCalculator.meta.keywords', [
                'TRON stake calculator',
                'TRX staking yield',
                'TRON energy staking',
                'TRX bandwidth calculator',
                'TRON staking returns',
                'TRX freeze calculator',
                'TRON Stake 2.0',
                'TRX energy vs rent'
            ])
        });
    }

    return metadata;
}

/**
 * Serve the CMS page when it answers here, redirect to its current address
 * when an admin has moved it, and render the built-in calculator page when no
 * CMS page answers.
 *
 * @param props - Route props carrying the request language.
 * @returns The page body.
 */
export default async function StakeCalculatorPage({ params }: IStakeCalculatorPageProps) {
    const language = await resolveMetadataLanguage(params);
    const [render, data, { siteUrl }] = await Promise.all([
        readPageRender(language),
        readPageMetadata(language),
        getServerConfig()
    ]);

    // The page moved: send the visitor to its current address in the language
    // they asked for, as the catch-all route does for a renamed CMS page.
    if (render && render.currentSlug !== STAKE_CALCULATOR_PATH) {
        redirect(localizePath(render.currentSlug, language));
    }

    return render
        ? <CmsPageArticle render={render} page={data?.page ?? null} language={language} siteUrl={siteUrl} />
        : <StakeCalculator />;
}
