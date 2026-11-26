/**
 * @fileoverview Staking rewards calculator route.
 *
 * This address is the default address of the staking rewards CMS page an
 * admin creates from `/system/tools`. Once that page is published here in the
 * visitor's language, this route serves it, and the embedded calculator gets
 * its data from the widget's own server-side fetcher. If an admin moves the
 * page, the old address redirects to the new one.
 *
 * When no CMS page answers in the visitor's language, the built-in calculator
 * page is served with the stored rewards snapshot read here on the server, so
 * the representative table is in the first HTML. A backend that cannot be
 * reached gives the built-in page with no snapshot, which says the figures are
 * not ready rather than failing.
 */

import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import type { IStakingRewardsSnapshot } from '@/types';
import { localizePath, STAKING_REWARDS_PATH } from '@/types';
import { getServerSideApiUrl } from '../../../../../../lib/api-url';
import { buildMetadata } from '../../../../../../lib/seo';
import { getServerConfig } from '../../../../../../lib/serverConfig';
import { translateKeywords } from '../../../../../../lib/translateKeywords';
import { getServerTranslator, resolveMetadataLanguage } from '../../../../../../modules/localization/server';
import { CmsPageArticle } from '../../../../../../modules/pages/server';
import type { IPublicPageRenderResponse, IPublicPageResponse } from '../../../../../../modules/pages';
import { fetchPublicPageMetadata, fetchPublicPageRender } from '../../../../../../modules/pages/server';
import { StakingRewards } from '../../../../../../modules/tools';

/**
 * Seconds a rendered snapshot may be reused. The snapshot changes every six
 * hours, so five minutes keeps the table current without a backend read on
 * every page view.
 */
const SNAPSHOT_REVALIDATE_SECONDS = 300;

/** Route props; `params.lang` is the language the middleware routed to. */
interface IStakingRewardsPageProps {
    params: Promise<{ lang: string }>;
}

/**
 * Read the metadata of the CMS page answering at this address, including a
 * page that has moved away and only redirects from here. A backend error
 * yields null, so an outage falls back to the built-in page.
 *
 * @param language - The language being rendered.
 * @returns The page's metadata, or null when no page answers here.
 */
async function readPageMetadata(language: string): Promise<IPublicPageResponse | null> {
    let data: IPublicPageResponse | null = null;
    try {
        data = await fetchPublicPageMetadata(STAKING_REWARDS_PATH, language);
    } catch (error) {
        console.error('Failed to read the staking rewards CMS page metadata:', error);
    }

    return data;
}

/**
 * Read the rendered CMS page answering at this address. Handles a backend
 * error the same way as `readPageMetadata`.
 *
 * @param language - The language being rendered.
 * @returns The rendered page, or null when no page answers here.
 */
async function readPageRender(language: string): Promise<IPublicPageRenderResponse | null> {
    let render: IPublicPageRenderResponse | null = null;
    try {
        render = await fetchPublicPageRender(STAKING_REWARDS_PATH, language);
    } catch (error) {
        console.error('Failed to read the staking rewards CMS page:', error);
    }

    return render;
}

/**
 * Read the stored rewards snapshot for the built-in page.
 *
 * @returns The snapshot, or null when none is stored yet or the backend could not be read.
 */
async function readSnapshot(): Promise<IStakingRewardsSnapshot | null> {
    let snapshot: IStakingRewardsSnapshot | null = null;
    try {
        const response = await fetch(`${getServerSideApiUrl()}/api/tools/staking-rewards`, {
            next: { revalidate: SNAPSHOT_REVALIDATE_SECONDS }
        });
        if (response.ok) {
            snapshot = (await response.json() as { snapshot: IStakingRewardsSnapshot | null }).snapshot;
        } else {
            console.error('Failed to read the staking rewards snapshot:', response.status, response.statusText);
        }
    } catch (error) {
        console.error('Error reading the staking rewards snapshot:', error);
    }

    return snapshot;
}

/**
 * Generate SEO metadata: the CMS page's own fields when it is served here,
 * nothing when it has moved (the body redirects), and the built-in metadata
 * targeting TRX staking and voting reward searches otherwise.
 *
 * @param props - Route props; `params.lang` selects the language the canonical URL uses.
 * @returns The page's metadata.
 */
export async function generateMetadata({ params }: IStakingRewardsPageProps): Promise<Metadata> {
    const [{ siteUrl }, { t, language }] = await Promise.all([getServerConfig(), getServerTranslator(params)]);
    const data = await readPageMetadata(language);

    let metadata: Metadata;
    if (data && data.page.slug !== STAKING_REWARDS_PATH) {
        metadata = {};
    } else if (data) {
        metadata = buildMetadata({
            siteUrl,
            language,
            title: data.page.title,
            description: data.page.description,
            path: STAKING_REWARDS_PATH,
            image: data.page.ogImage,
            keywords: data.page.keywords
        });
    } else {
        metadata = buildMetadata({
            siteUrl,
            language,
            title: t('tools.stakingRewards.meta.title', 'TRON Staking Rewards Calculator | TRX Voting Rewards by Super Representative'),
            description: t(
                'tools.stakingRewards.meta.description',
                'Estimate yearly TRX rewards from staking and voting on TRON. Compare every Super Representative by commission and reward rate, from live on-chain figures.'
            ),
            path: STAKING_REWARDS_PATH,
            keywords: translateKeywords(t, 'tools.stakingRewards.meta.keywords', [
                'TRON staking rewards calculator',
                'TRX staking rewards',
                'TRX staking APR',
                'TRON voting rewards',
                'Super Representative rewards',
                'TRON SR commission',
                'TRX staking calculator',
                'TRON Stake 2.0 rewards'
            ])
        });
    }

    return metadata;
}

/**
 * Serve the CMS page when it answers here, redirect when an admin has moved
 * it, and render the built-in calculator page with the stored snapshot otherwise.
 *
 * @param props - Route props carrying the request language.
 * @returns The page body.
 */
export default async function StakingRewardsPage({ params }: IStakingRewardsPageProps) {
    const language = await resolveMetadataLanguage(params);
    const [render, data, { siteUrl }] = await Promise.all([
        readPageRender(language),
        readPageMetadata(language),
        getServerConfig()
    ]);

    // The page moved: send the visitor to its current address in the language
    // they asked for, as the catch-all route does for a renamed CMS page.
    if (render && render.currentSlug !== STAKING_REWARDS_PATH) {
        redirect(localizePath(render.currentSlug, language));
    }

    return render
        ? <CmsPageArticle render={render} page={data?.page ?? null} language={language} siteUrl={siteUrl} />
        : <StakingRewards snapshot={await readSnapshot()} />;
}
