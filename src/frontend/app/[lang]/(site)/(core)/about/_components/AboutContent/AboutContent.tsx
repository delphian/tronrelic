'use client';

/**
 * @fileoverview Body of the public `/about` page.
 *
 * The page explains to a first-time visitor what TronRelic offers. Every
 * visible string goes through `t()`, so the page can be published in other
 * languages from `/system/localization` without a code change. The component
 * is a client component only because `useTranslation` is a hook; it has no
 * data to fetch, so the server renders it in full and nothing loads later.
 */

import { Page, PageHeader, Grid, Section } from '../../../../../../../components/layout';
import { Card } from '../../../../../../../components/ui/Card';
import { useTranslation } from '../../../../../../../modules/localization';

/** One feature area described on the page. */
interface IAboutItem {
    /** Stable identifier used as the React key. */
    id: string;

    /** Translated heading for the feature area. */
    title: string;

    /** Translated one-paragraph description. */
    description: string;
}

/**
 * Render the About page body.
 *
 * Builds the feature list inside the component because each entry needs the
 * translator, then lays it out as a responsive grid of cards under the page
 * header.
 *
 * @returns The About page content.
 */
export function AboutContent() {
    const { t } = useTranslation();

    const items: IAboutItem[] = [
        {
            id: 'markets',
            title: t('about.markets.title', 'Energy rental prices'),
            description: t(
                'about.markets.description',
                'Compare what it costs to rent TRON energy across the major rental markets, with prices shown in SUN per unit of energy for hourly, daily, and weekly rentals.'
            )
        },
        {
            id: 'activity',
            title: t('about.activity.title', 'Live blockchain activity'),
            description: t(
                'about.activity.description',
                'TronRelic reads every new block as TRON produces it. Large transfers, transaction memos, and new blocks appear on the site within seconds.'
            )
        },
        {
            id: 'tools',
            title: t('about.tools.title', 'Free TRON tools'),
            description: t(
                'about.tools.description',
                'Estimate the energy a transaction needs, calculate staking returns, convert addresses and timestamps, verify signatures, and check which contracts can spend your tokens.'
            )
        },
        {
            id: 'wallets',
            title: t('about.wallets.title', 'Your wallet, your keys'),
            description: t(
                'about.wallets.description',
                'You link a wallet by signing a message with it. TronRelic never asks for your private key or seed phrase, and signing a message cannot move your funds.'
            )
        },
        {
            id: 'community',
            title: t('about.community.title', 'Community and news'),
            description: t(
                'about.community.description',
                'Read TRON news and analysis on the blog, and post to the forum with your wallet.'
            )
        },
        {
            id: 'open-source',
            title: t('about.openSource.title', 'Open source'),
            description: t(
                'about.openSource.description',
                'The core of TronRelic is open source under the AGPL license. Anyone can read the code, run their own copy, or build a plugin that adds a new feature.'
            )
        }
    ];

    return (
        <Page>
            <PageHeader
                title={t('about.title', 'About TronRelic')}
                subtitle={t(
                    'about.subtitle',
                    'TronRelic is an analytics site for the TRON blockchain. It turns raw on-chain data into energy prices, live activity feeds, and tools anyone can use.'
                )}
            />
            <Section>
                <Grid columns="responsive">
                    {items.map(item => (
                        <Card key={item.id}>
                            <h2>{item.title}</h2>
                            <p className="text-muted">{item.description}</p>
                        </Card>
                    ))}
                </Grid>
            </Section>
        </Page>
    );
}
