/**
 * @fileoverview Tools landing page displaying a grid of available tools.
 *
 * Renders a card for each tool with its name, description, and a link to
 * the individual tool page. Pure navigation page with no SSR data requirements.
 */

import Link from 'next/link';
import { ArrowLeftRight, Zap, Calculator, ShieldCheck } from 'lucide-react';
import { Page, PageHeader, Grid } from '../../../../components/layout';
import styles from './ToolsLandingPage.module.scss';

const TOOLS = [
    {
        title: 'Address Converter',
        description: 'Convert between TRON hex and base58check address formats.',
        href: '/tools/address-converter',
        icon: <ArrowLeftRight size={24} />
    },
    {
        title: 'Energy Estimator',
        description: 'Estimate daily energy requirements and compare staking vs rental costs.',
        href: '/tools/energy-estimator',
        icon: <Zap size={24} />
    },
    {
        title: 'Stake Calculator',
        description: 'Calculate energy and bandwidth from a TRX stake, or TRX needed for a target energy amount.',
        href: '/tools/stake-calculator',
        icon: <Calculator size={24} />
    },
    {
        title: 'Signature Verifier',
        description: 'Verify a TRON wallet signed a specific message. Supports direct URL linking.',
        href: '/tools/signature-verifier',
        icon: <ShieldCheck size={24} />
    }
];

/**
 * Tools landing page component.
 *
 * Displays a responsive grid of tool cards, each linking to its dedicated page.
 * No SSR data needed — this is a static navigation page.
 */
export function ToolsLandingPage() {
    return (
        <Page>
            <PageHeader
                title="Tools"
                subtitle="TRON blockchain utilities"
            />
            <Grid columns="responsive" gap="md">
                {TOOLS.map(tool => (
                    <Link key={tool.href} href={tool.href} className={styles.card}>
                        <div className={styles.card__icon}>
                            {tool.icon}
                        </div>
                        <h3 className={styles.card__title}>{tool.title}</h3>
                        <p className={styles.card__description}>{tool.description}</p>
                    </Link>
                ))}
            </Grid>
        </Page>
    );
}
