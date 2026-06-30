'use client';

/**
 * @fileoverview The "wallet story" stat strip — the engaging, timestamp-only
 * summary revealed when a wallet finishes syncing. Total transactions, how long
 * the wallet has been active, how many distinct days, and its longest run of
 * consecutive active days give a wallet a personality at a glance, at near-zero
 * compute cost.
 */

import { Activity, CalendarClock, CalendarRange, Flame } from 'lucide-react';
import type { IWalletActivityStats } from '@/types';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { WalletDetailSection, StatTile } from './WalletDetailPrimitives';
import { formatCount } from '../../../lib/walletFormat';

/**
 * Props for {@link WalletActivityStats}.
 */
interface IWalletActivityStatsProps {
    /** The all-time activity rollups for the wallet. */
    stats: IWalletActivityStats;
}

/**
 * Render the wallet's all-time activity rollups as a stat strip.
 *
 * @param props - {@link IWalletActivityStatsProps}.
 * @returns The activity stats section.
 */
export function WalletActivityStats({ stats }: IWalletActivityStatsProps) {
    return (
        <WalletDetailSection icon={<Activity size={16} aria-hidden />} title="Activity">
            <div className="stat-grid">
                <StatTile label="Transactions" value={formatCount(stats.totalTransactions)} />
                <StatTile label="Active days" value={formatCount(stats.activeDays)} />
                <StatTile label="Longest streak" value={`${formatCount(stats.longestStreakDays)} d`} icon={<Flame size={14} aria-hidden style={{ color: 'var(--color-warning)' }} />} />
                <StatTile
                    label="First activity"
                    icon={<CalendarRange size={14} aria-hidden />}
                    value={stats.firstActivityAt ? <ClientTime date={stats.firstActivityAt} format="date" /> : '—'}
                />
                <StatTile
                    label="Last activity"
                    icon={<CalendarClock size={14} aria-hidden />}
                    value={stats.lastActivityAt ? <ClientTime date={stats.lastActivityAt} format="date" /> : '—'}
                />
            </div>
        </WalletDetailSection>
    );
}
