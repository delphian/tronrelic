/**
 * @fileoverview Route wrapper for the public `/about` page.
 *
 * Builds the page metadata and renders `AboutContent`, which holds the page
 * text. The text lives in the client component because it is rendered
 * through `t()`, the translation hook.
 */

import type { Metadata } from 'next';
import { buildMetadata } from '../../../../../lib/seo';
import { getServerConfig } from '../../../../../lib/serverConfig';
import { getServerTranslator } from '../../../../../modules/localization/server';
import { AboutContent } from './_components/AboutContent';

export const revalidate = 3600;

/**
 * Build the About page metadata in the page's language, so a translated copy
 * shows search engines a translated title and description and a canonical
 * URL pointing at its own address rather than the English page.
 *
 * Keywords stay in English: search engines largely ignore the keywords tag,
 * so translating it would add keys for translators with no benefit.
 *
 * @param props - Route props; `params.lang` selects the language described.
 * @returns The page metadata.
 */
export async function generateMetadata({ params }: { params: Promise<{ lang: string }> }): Promise<Metadata> {
    const [{ siteUrl }, { t, language }] = await Promise.all([getServerConfig(), getServerTranslator(params)]);

    return buildMetadata({
        siteUrl,
        language,
        title: t('about.meta.title', 'About TronRelic | TRON Energy Prices, Live Activity, and Tools'),
        description: t(
            'about.meta.description',
            'TronRelic is an open-source analytics site for the TRON blockchain: energy rental prices across markets, live whale and memo feeds, and free TRON tools.'
        ),
        path: '/about',
        keywords: ['TronRelic', 'TRON analytics', 'TRON energy prices', 'TRON tools']
    });
}

/**
 * Render the About page.
 *
 * @returns The About page content.
 */
export default function AboutPage() {
    return <AboutContent />;
}
