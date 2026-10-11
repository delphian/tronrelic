'use client';

/**
 * @fileoverview Single-wallet detail view for the profile Wallets tab.
 *
 * Progressive disclosure is capped at two levels (NNG): the switcher chooses the
 * wallet, and this panel's segmented sub-tabs — Overview / Activity /
 * Transactions — split what used to be one endless vertical dump into three
 * scannable surfaces. Overview is the portfolio hero (money first); Activity is
 * the behavioural story, lazy-loaded only when opened; Transactions is the
 * decoded audit feed. A wallet still downloading its history shows an honest
 * "still syncing" notice (count + oldest date reached, never a fake percentage)
 * instead of a partial view mistaken for the whole picture.
 */

import { useEffect, useState } from 'react';
import { Hourglass } from 'lucide-react';
import type { IAccountIngestionProgress, IWalletActivitySummary } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Panel } from '../../../../../components/ui/Panel';
import { SegmentedControl, type ISegmentedControlOption } from '../../../../../components/ui/SegmentedControl';
import { Skeleton } from '../../../../../components/ui/Skeleton';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { fetchWalletSummary, type IAddressLabelMap } from '../../../api/account-history-user.api';
import { describeHistoryStatus } from '../../../lib/walletHistoryStatus';
import { formatCount } from '../../../lib/walletFormat';
import { WalletActivityStats } from './WalletActivityStats';
import { WalletActivityCalendar } from './WalletActivityCalendar';
import { WalletFlowChart } from './WalletFlowChart';
import { WalletCounterparties } from './WalletCounterparties';
import { WalletTransactionFeed } from './WalletTransactionFeed';
import { PortfolioPanel } from './PortfolioPanel';
import styles from './WalletDetail.module.scss';

/** The detail sub-tabs, in display order. */
type DetailTab = 'overview' | 'activity' | 'transactions';

/** Tab row definition, in display order. */
const DETAIL_TABS: ReadonlyArray<ISegmentedControlOption<DetailTab>> = [
    { id: 'overview', label: 'Overview' },
    { id: 'activity', label: 'Activity' },
    { id: 'transactions', label: 'Transactions' }
];

/**
 * Props for {@link WalletDetailPanel}.
 */
interface IWalletDetailPanelProps {
    /** The base58 wallet to render. */
    address: string;

    /**
     * The wallet's ingestion progress, if known. The full detail view unlocks
     * only once its backfill is `complete`; before then the panel shows the
     * honest syncing notice instead of partial data.
     */
    progress?: IAccountIngestionProgress;
}

/**
 * Skeleton shaped like the activity panels, shown while the summary loads. A
 * loading state is appropriate here because this is a user-triggered, secondary
 * surface (the Activity sub-tab), not the page's primary render.
 *
 * @returns A stack of skeleton placeholders.
 */
function ActivitySkeleton() {
    return (
        <Stack gap="md">
            <Skeleton style={{ width: '100%', height: '6rem' }} />
            <Skeleton style={{ width: '100%', height: '8rem' }} />
            <Skeleton style={{ width: '100%', height: '12rem' }} />
        </Stack>
    );
}

/**
 * Honest "still syncing" notice for a wallet whose backfill has not completed.
 * Presents the absolute records-saved count and the oldest point reached —
 * monotonic, truthful signals — rather than a percentage the data cannot support.
 *
 * @param props - The wallet's ingestion progress.
 * @returns The syncing notice section.
 */
function WalletSyncNotice({ progress }: { progress?: IAccountIngestionProgress }) {
    const status = progress ? describeHistoryStatus(progress) : null;
    return (
        <Panel
            title="Downloading history"
            tone="muted"
            meta={progress ? (
                <>
                    {formatCount(progress.rowsIngested)} records saved
                    {progress.oldestTimestampReached && (
                        <>, back to <ClientTime date={progress.oldestTimestampReached} format="date" /></>
                    )}
                </>
            ) : undefined}
        >
            <p className={styles.notice}>
                <Hourglass size={14} aria-hidden style={{ color: 'var(--color-primary)' }} />
                {status ? status.tooltip : 'This wallet’s transaction history is still downloading.'}
                {' '}Portfolio, activity, and the full transaction feed unlock here once it completes.
            </p>
        </Panel>
    );
}

/**
 * Render the single-wallet detail view.
 *
 * @param props - {@link IWalletDetailPanelProps}.
 * @returns The wallet detail panel.
 */
export function WalletDetailPanel({ address, progress }: IWalletDetailPanelProps) {
    const [tab, setTab] = useState<DetailTab>('overview');
    const [summary, setSummary] = useState<IWalletActivitySummary | null>(null);
    const [summaryLabels, setSummaryLabels] = useState<IAddressLabelMap>({});
    const [summaryLoading, setSummaryLoading] = useState(false);
    const [summaryError, setSummaryError] = useState<string | null>(null);

    // Reset to Overview and drop the cached activity summary whenever the wallet
    // changes, so a switch never shows one wallet's activity under another. Doing
    // this during render (not in an effect) lands the reset before children render
    // and before the lazy-fetch effect runs, so switching wallets while the
    // Activity tab is open can neither flash the prior wallet's data nor fire a
    // wasted request for the new address under the stale tab.
    const [prevAddress, setPrevAddress] = useState(address);
    if (address !== prevAddress) {
        setPrevAddress(address);
        setTab('overview');
        setSummary(null);
        setSummaryLabels({});
        setSummaryError(null);
    }

    const isComplete = progress ? describeHistoryStatus(progress).complete : false;

    // Lazy-load the activity summary the first time the Activity tab is opened for
    // this wallet. The guard on summary/summaryError stops it re-fetching once
    // resolved, so switching tabs back and forth costs one request, not many.
    useEffect(() => {
        if (tab !== 'activity' || summary !== null || summaryError !== null) {
            return;
        }
        let active = true;
        setSummaryLoading(true);
        fetchWalletSummary(address)
            .then((result) => {
                if (active) {
                    setSummary(result.summary);
                    setSummaryLabels(result.labels);
                }
            })
            .catch((cause: unknown) => {
                if (active) {
                    setSummaryError(cause instanceof Error ? cause.message : 'Failed to load wallet activity.');
                }
            })
            .finally(() => {
                if (active) {
                    setSummaryLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [tab, address, summary, summaryError]);

    // Not finished downloading: show the honest syncing notice, no sub-tabs.
    if (!isComplete) {
        return (
            <div className={styles.detail}>
                <WalletSyncNotice progress={progress} />
            </div>
        );
    }

    return (
        <div className={styles.detail}>
            <Stack gap="sm">
                <SegmentedControl
                    variant="tablist"
                    label="Wallet detail sections"
                    value={tab}
                    options={DETAIL_TABS}
                    onChange={setTab}
                    className={styles.detail_tabs}
                />

                {tab === 'overview' && <PortfolioPanel address={address} />}

                {tab === 'activity' && (
                    summaryError ? (
                        <div className="alert">{summaryError}</div>
                    ) : summaryLoading || summary === null ? (
                        <ActivitySkeleton />
                    ) : (
                        <>
                            <WalletActivityStats stats={summary.stats} resources={summary.resources} />
                            <WalletActivityCalendar calendar={summary.calendar} />
                            <WalletFlowChart
                                address={address}
                                flow={summary.flow}
                                counterparties={summary.counterparties}
                                labels={summaryLabels}
                            />
                            <WalletCounterparties counterparties={summary.counterparties} labels={summaryLabels} />
                        </>
                    )
                )}

                {tab === 'transactions' && <WalletTransactionFeed address={address} />}
            </Stack>
        </div>
    );
}
