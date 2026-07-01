'use client';

/**
 * @fileoverview Self-fetching wrapper around {@link PortfolioHero}.
 *
 * The aggregate hero is the Wallets tab's landing content, so it is SSR-seeded
 * (`initialSummary`) and renders real numbers on first paint with no skeleton —
 * following the SSR + Live Updates rule for primary content. The per-wallet zoom
 * has no seed (a wallet is chosen by a client interaction, so a skeleton is
 * appropriate there) and self-fetches on mount. Pass an `address` for the
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

    /**
     * SSR-resolved aggregate summary, seeding the hero so it paints real content
     * with no loading flash. Only supplied for the aggregate scope; when present
     * the panel mirrors it instead of self-fetching (the seed is `no-store`-fresh
     * on mount, and the parent refetches and passes a new object after a wallet
     * mutation, which this panel picks up the same way). Null when the SSR fetch
     * failed, in which case the panel falls back to client fetch.
     */
    initialSummary?: IPortfolioSummary | null;
}

/**
 * Fetch and render the portfolio hero for a wallet or the aggregate.
 *
 * @param props - {@link IPortfolioPanelProps}.
 * @returns The hero, a skeleton while loading, or an alert on error.
 */
export function PortfolioPanel({ address, initialSummary }: IPortfolioPanelProps) {
    const [summary, setSummary] = useState<IPortfolioSummary | null>(initialSummary ?? null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        // Aggregate scope is seeded — and re-seeded — by the parent, which owns
        // the summary and refetches it after a wallet-set change (link / unlink).
        // Mirror whatever seed is current instead of self-fetching: the SSR seed
        // paints with no skeleton flash, and a post-mutation reseed swaps the
        // numbers in place without one either.
        if (!address && initialSummary) {
            setSummary(initialSummary);
            return;
        }
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
    }, [address, initialSummary]);

    if (error) {
        return <div className="alert">{error}</div>;
    }
    if (!summary) {
        return <Skeleton style={{ width: '100%', height: '12rem' }} />;
    }
    return <PortfolioHero summary={summary} />;
}
