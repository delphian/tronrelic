'use client';

/**
 * @fileoverview The wallet's all-time figures, shown when a wallet finishes
 * syncing. It folds two once-separate concerns into one section: the
 * timestamp-only activity rollups (transactions, active days, longest streak,
 * first and last activity) and the TRON-native resource totals (energy and
 * bandwidth consumed, fees and resource TRX burned).
 *
 * Ten figures are too many for tiles: a grid of ten boxes leaves orphans,
 * spends more area on borders than on numbers, and fills a screen. They are
 * drawn as a statement-style figure list instead, labels on the left and
 * right-aligned values on the right, flowing into as many columns as the panel
 * has room for.
 */

import type { IFigureListRow, IWalletActivityStats, IWalletResourceTotals } from '@/types';
import { Panel } from '../../../../../components/ui/Panel';
import { FigureList } from '../../../../../components/ui/FigureList';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { formatCount, formatTrxFromSun } from '../../../lib/walletFormat';

/**
 * Props for {@link WalletActivityStats}.
 */
interface IWalletActivityStatsProps {
    /** The all-time activity rollups for the wallet. */
    stats: IWalletActivityStats;
    /** The all-time energy/bandwidth/fee totals, merged into the same section. */
    resources: IWalletResourceTotals;
}

/**
 * Render the wallet's all-time activity rollups and TRON resource totals as
 * one figure list.
 *
 * @param props - {@link IWalletActivityStatsProps}.
 * @returns The merged activity and resources panel.
 */
export function WalletActivityStats({ stats, resources }: IWalletActivityStatsProps) {
    const rows: IFigureListRow[] = [
        { key: 'transactions', label: 'Transactions', value: formatCount(stats.totalTransactions) },
        { key: 'active-days', label: 'Active days', value: formatCount(stats.activeDays) },
        { key: 'streak', label: 'Longest streak', value: formatCount(stats.longestStreakDays), unit: 'days' },
        {
            key: 'first',
            label: 'First activity',
            value: stats.firstActivityAt ? <ClientTime date={stats.firstActivityAt} format="date" /> : '—'
        },
        {
            key: 'last',
            label: 'Last activity',
            value: stats.lastActivityAt ? <ClientTime date={stats.lastActivityAt} format="date" /> : '—'
        },
        { key: 'energy', label: 'Energy used', value: formatCount(resources.energyConsumed) },
        { key: 'bandwidth', label: 'Bandwidth used', value: formatCount(resources.bandwidthConsumed) },
        { key: 'fees', label: 'Total fees', value: formatTrxFromSun(resources.feeSun) },
        { key: 'energy-burned', label: 'Energy burned', value: formatTrxFromSun(resources.energyFeeSun) },
        { key: 'bandwidth-burned', label: 'Bandwidth burned', value: formatTrxFromSun(resources.bandwidthFeeSun) }
    ];

    return (
        <Panel title="Activity" meta="All time">
            <FigureList rows={rows} />
        </Panel>
    );
}
