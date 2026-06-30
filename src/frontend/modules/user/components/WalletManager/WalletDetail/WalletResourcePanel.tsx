'use client';

/**
 * @fileoverview The TRON resource panel — the chain-native differentiator.
 *
 * TRON meters energy and bandwidth per transaction, something no EVM portfolio
 * tracker can show. Summing what a wallet has consumed and burned over its whole
 * history gives a story unique to TRON: how resource-hungry the wallet is and how
 * much TRX it has spent on fees.
 */

import { Zap, Gauge, Flame } from 'lucide-react';
import type { IWalletResourceTotals } from '@/types';
import { WalletDetailSection, StatTile } from './WalletDetailPrimitives';
import { formatCount, formatTrxFromSun } from '../../../lib/walletFormat';

/**
 * Props for {@link WalletResourcePanel}.
 */
interface IWalletResourcePanelProps {
    /** The all-time energy/bandwidth/fee totals for the wallet. */
    resources: IWalletResourceTotals;
}

/**
 * Render the wallet's all-time TRON resource consumption and burned fees.
 *
 * @param props - {@link IWalletResourcePanelProps}.
 * @returns The resource totals section.
 */
export function WalletResourcePanel({ resources }: IWalletResourcePanelProps) {
    return (
        <WalletDetailSection icon={<Zap size={16} aria-hidden style={{ color: 'var(--color-warning)' }} />} title="Energy & resources">
            <div className="stat-grid">
                <StatTile label="Energy used" value={formatCount(resources.energyConsumed)} icon={<Zap size={14} aria-hidden />} />
                <StatTile label="Bandwidth used" value={formatCount(resources.bandwidthConsumed)} icon={<Gauge size={14} aria-hidden />} />
                <StatTile label="Total fees" value={formatTrxFromSun(resources.feeSun)} icon={<Flame size={14} aria-hidden />} />
                <StatTile label="Energy burned" value={formatTrxFromSun(resources.energyFeeSun)} />
                <StatTile label="Bandwidth burned" value={formatTrxFromSun(resources.bandwidthFeeSun)} />
            </div>
        </WalletDetailSection>
    );
}
