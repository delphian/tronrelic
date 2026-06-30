'use client';

/**
 * @fileoverview Self-fetching wrapper around {@link PortfolioHero}.
 *
 * The valuation hero is a secondary, expand-triggered surface (it loads when a
 * wallet row is opened, or when the aggregate view mounts), so a loading skeleton
 * is appropriate here — unlike primary page content. Pass an `address` for the
 * single-wallet zoom, or omit it for the all-wallets aggregate; the same hero
 * renders both because the summary shape is scope-agnostic.
 */

import { useEffect, useState } from 'react';
import type { IPortfolioSummary } from '@/types';
import { Skeleton } from '../../../../../components/ui/Skeleton';
import { fetchWalletPortfolio, fetchAggregatePortfolio } from '../../../api/valuation-user.api';
import { PortfolioHero } from './PortfolioHero';

/**
 * Props for {@link PortfolioPanel}.
 */
interface IPortfolioPanelProps {
    /** A single owned wallet to value, or undefined for the user-wide aggregate. */
    address?: string;
}

/**
 * Fetch and render the portfolio hero for a wallet or the aggregate.
 *
 * @param props - {@link IPortfolioPanelProps}.
 * @returns The hero, a skeleton while loading, or an alert on error.
 */
export function PortfolioPanel({ address }: IPortfolioPanelProps) {
    const [summary, setSummary] = useState<IPortfolioSummary | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setSummary(null);
        setError(null);
        const request = address ? fetchWalletPortfolio(address) : fetchAggregatePortfolio();
        request
            .then((result) => {
                if (active) {
                    setSummary(result);
                }
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(cause instanceof Error ? cause.message : 'Failed to load portfolio.');
                }
            });
        return () => {
            active = false;
        };
    }, [address]);

    if (error) {
        return <div className="alert">{error}</div>;
    }
    if (!summary) {
        return <Skeleton style={{ width: '100%', height: '12rem' }} />;
    }
    return <PortfolioHero summary={summary} />;
}
