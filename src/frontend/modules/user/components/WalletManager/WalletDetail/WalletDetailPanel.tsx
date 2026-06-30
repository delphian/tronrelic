'use client';

/**
 * @fileoverview Container for one wallet's detail view.
 *
 * Lazy-loads the batched activity summary when a wallet row is expanded — a
 * user-triggered, secondary surface, so a loading skeleton is appropriate here
 * (unlike the page's primary render). The valuation/portfolio surface is a
 * deliberate future addition: a hero slot is reserved at the top of the stack so
 * that, when a balance/price data layer exists, the portfolio value + PnL +
 * balance-over-time hero drops in above these activity panels without touching
 * them.
 */

import { useEffect, useState } from 'react';
import type { IWalletActivitySummary } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Skeleton } from '../../../../../components/ui/Skeleton';
import { fetchWalletSummary } from '../../../api/account-history-user.api';
import { WalletActivityStats } from './WalletActivityStats';
import { WalletActivityCalendar } from './WalletActivityCalendar';
import { WalletResourcePanel } from './WalletResourcePanel';
import { WalletFlowChart } from './WalletFlowChart';
import { WalletCounterparties } from './WalletCounterparties';
import { WalletTransactionFeed } from './WalletTransactionFeed';
import { PortfolioPanel } from './PortfolioPanel';
import styles from './WalletDetail.module.scss';

/**
 * Props for {@link WalletDetailPanel}.
 */
interface IWalletDetailPanelProps {
    /** The base58 wallet to summarize; the panel mounts only for synced wallets. */
    address: string;
}

/**
 * Placeholder rendered while the summary loads — skeleton blocks shaped like the
 * panels they replace, so the reveal does not shift layout and the user never
 * sees an empty/zeroed state mistaken for "no activity".
 *
 * @returns A stack of skeleton placeholders.
 */
function WalletDetailSkeleton() {
    return (
        <Stack gap="md">
            <Skeleton style={{ width: '100%', height: '5rem' }} />
            <Skeleton style={{ width: '100%', height: '7rem' }} />
            <Skeleton style={{ width: '100%', height: '16rem' }} />
        </Stack>
    );
}

/**
 * Render the full activity/behaviour detail view for one wallet.
 *
 * @param props - {@link IWalletDetailPanelProps}.
 * @returns The wallet detail panel.
 */
export function WalletDetailPanel({ address }: IWalletDetailPanelProps) {
    const [summary, setSummary] = useState<IWalletActivitySummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        let active = true;
        setLoading(true);
        setError(null);
        fetchWalletSummary(address)
            .then((result) => {
                if (active) {
                    setSummary(result);
                }
            })
            .catch((cause: unknown) => {
                if (active) {
                    setError(cause instanceof Error ? cause.message : 'Failed to load wallet activity.');
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [address]);

    return (
        <div className={styles.detail}>
            <Stack gap="md">
                {/*
                  * Valuation hero. Self-fetching and scoped to this wallet; it
                  * loads its own portfolio summary (net worth, PnL, allocation,
                  * balance-over-time) independently of the activity summary above.
                  */}
                <PortfolioPanel address={address} />
                {error ? (
                    <div className="alert">{error}</div>
                ) : loading || !summary ? (
                    <WalletDetailSkeleton />
                ) : (
                    <>
                        <WalletActivityStats stats={summary.stats} />
                        <WalletActivityCalendar calendar={summary.calendar} />
                        <WalletResourcePanel resources={summary.resources} />
                        <WalletFlowChart flow={summary.flow} />
                        <WalletCounterparties counterparties={summary.counterparties} />
                    </>
                )}
                {!error && <WalletTransactionFeed address={address} />}
            </Stack>
        </div>
    );
}
