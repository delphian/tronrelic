'use client';

/**
 * @fileoverview The "wallet story" stat strip — the engaging summary revealed when a
 * wallet finishes syncing. It folds two once-separate concerns into one section: the
 * timestamp-only activity rollups (transactions, active days, longest streak, first/last
 * activity) and the TRON-native resource totals (energy and bandwidth consumed, fees and
 * resource TRX burned). They share the same "labelled value in a small tile" shape and
 * belong to the same glance, so one section reads better than two — the resource tiles
 * keep their own icons so their meaning survives the merge. Tiles render compact so the
 * combined ten-metric grid stays dense rather than sprawling.
 */

import { Activity, CalendarClock, CalendarRange, Flame, Zap, Gauge } from 'lucide-react';
import type { IWalletActivityStats, IWalletResourceTotals } from '@/types';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { WalletDetailSection, StatTile } from './WalletDetailPrimitives';
import { formatCount, formatTrxFromSun } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

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
 * Render the wallet's all-time activity rollups and TRON resource totals as one
 * compact stat strip.
 *
 * @param props - {@link IWalletActivityStatsProps}.
 * @returns The merged activity + resources section.
 */
export function WalletActivityStats({ stats, resources }: IWalletActivityStatsProps) {
    return (
        <WalletDetailSection icon={<Activity size={16} aria-hidden />} title="Activity">
            <div className={`stat-grid ${styles.stat_grid_compact}`}>
                <StatTile compact label="Transactions" value={formatCount(stats.totalTransactions)} />
                <StatTile compact label="Active days" value={formatCount(stats.activeDays)} />
                <StatTile compact label="Longest streak" value={`${formatCount(stats.longestStreakDays)} d`} icon={<Flame size={14} aria-hidden style={{ color: 'var(--color-warning)' }} />} />
                <StatTile
                    compact
                    label="First activity"
                    icon={<CalendarRange size={14} aria-hidden />}
                    value={stats.firstActivityAt ? <ClientTime date={stats.firstActivityAt} format="date" /> : '—'}
                />
                <StatTile
                    compact
                    label="Last activity"
                    icon={<CalendarClock size={14} aria-hidden />}
                    value={stats.lastActivityAt ? <ClientTime date={stats.lastActivityAt} format="date" /> : '—'}
                />
                <StatTile compact label="Energy used" value={formatCount(resources.energyConsumed)} icon={<Zap size={14} aria-hidden />} />
                <StatTile compact label="Bandwidth used" value={formatCount(resources.bandwidthConsumed)} icon={<Gauge size={14} aria-hidden />} />
                <StatTile compact label="Total fees" value={formatTrxFromSun(resources.feeSun)} icon={<Flame size={14} aria-hidden />} />
                <StatTile compact label="Energy burned" value={formatTrxFromSun(resources.energyFeeSun)} />
                <StatTile compact label="Bandwidth burned" value={formatTrxFromSun(resources.bandwidthFeeSun)} />
            </div>
        </WalletDetailSection>
    );
}
