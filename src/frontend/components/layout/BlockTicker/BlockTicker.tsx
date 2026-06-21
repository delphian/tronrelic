'use client';

import { Fragment } from 'react';
import {
    Activity,
    ArrowRightLeft,
    Box,
    Coins,
    FileCode,
    Handshake,
    Lock,
    Zap,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useAppSelector } from '../../../store/hooks';
import { cn } from '../../../lib/cn';
import type { BlockSummary } from '../../../features/blockchain/slice';
import styles from './BlockTicker.module.scss';

/**
 * Props for the BlockTicker component.
 */
interface IBlockTickerProps {
    /**
     * Initial block data passed from server component for SSR rendering.
     * When provided, the ticker renders immediately without waiting for WebSocket.
     * After hydration, live Redux updates take over.
     */
    initialBlock?: BlockSummary | null;
}

/**
 * One metric rendered in the ticker row.
 *
 * The ticker is data-driven so the eight (or nine, with energy) entries share a
 * single render path instead of repeating near-identical markup per metric. Each
 * entry carries the icon that replaces its former text label and the human label
 * that still feeds the hover tooltip and the screen-reader text — the visual is
 * compact, the meaning is never lost.
 */
interface ITickerMetric {
    /** Stable React key and identity for the metric. */
    key: string;
    /** Human-readable name shown in the tooltip and announced to assistive tech. */
    label: string;
    /** Lucide glyph standing in for the text label to reclaim horizontal space. */
    icon: LucideIcon;
    /** Pre-formatted display value (locale-grouped or compacted). */
    value: string;
    /** Highlights the block number as the primary metric. */
    primary?: boolean;
}

/**
 * BlockTicker - Compact real-time blockchain status ticker
 *
 * Follows the SSR + Live Updates pattern: renders with server-provided data
 * immediately, then hydrates for WebSocket-driven live updates.
 *
 * To stay compact horizontally, each metric's text label is replaced by a Lucide
 * icon; the original wording survives as a native `title` tooltip (hover) and as
 * visually-hidden text for screen readers, so meaning is preserved without the
 * width cost of spelled-out labels. The metrics displayed:
 * - **Block number** - Most recent indexed block (highlighted) — `Box`
 * - **Transaction count** - Total transactions in latest block — `Activity`
 * - **Transfer count** - TRX/TRC-10/TRC-20 transfer operations — `ArrowRightLeft`
 * - **Contract calls** - Smart contract interactions — `FileCode`
 * - **Delegations** - Resource delegation operations — `Handshake`
 * - **Stakes** - Staking operations (freezeBalance, unfreezeBalance) — `Lock`
 * - **Tokens** - New token creation operations — `Coins`
 * - **Energy usage** - Total energy consumed, only when > 0 — `Zap`
 *
 * The component subscribes to Redux blockchain state and updates in real-time
 * as blocks are processed by the backend sync service. It serves as a mini
 * version of the full CurrentBlock component, providing at-a-glance sync status
 * without consuming significant vertical space.
 *
 * Responsive design:
 * - Desktop: Icon metrics with comfortable spacing
 * - Tablet: Reduced spacing, maintained visibility
 * - Mobile: Tightest spacing with horizontal scroll
 *
 * @param props - Component properties including optional SSR initial block data
 * @returns A fixed-position ticker bar or null if no data available
 */
export function BlockTicker({ initialBlock }: IBlockTickerProps) {
    const reduxBlock = useAppSelector(state => state.blockchain.latestBlock);

    // SSR + Live Updates: Use Redux data when available, fall back to SSR initial data
    const latestBlock = reduxBlock || initialBlock;

    if (!latestBlock) {
        return null;
    }

    const metrics: ITickerMetric[] = [
        {
            key: 'block',
            label: 'Block',
            icon: Box,
            value: latestBlock.blockNumber.toLocaleString(),
            primary: true,
        },
        {
            key: 'transactions',
            label: 'Transactions',
            icon: Activity,
            value: latestBlock.transactionCount.toLocaleString(),
        },
        {
            key: 'transfers',
            label: 'Transfers',
            icon: ArrowRightLeft,
            value: latestBlock.stats.transfers.toLocaleString(),
        },
        {
            key: 'contracts',
            label: 'Contracts',
            icon: FileCode,
            value: latestBlock.stats.contractCalls.toLocaleString(),
        },
        {
            key: 'delegations',
            label: 'Delegations',
            icon: Handshake,
            value: latestBlock.stats.delegations.toLocaleString(),
        },
        {
            key: 'stakes',
            label: 'Stakes',
            icon: Lock,
            value: latestBlock.stats.stakes.toLocaleString(),
        },
        {
            key: 'tokens',
            label: 'Tokens',
            icon: Coins,
            value: latestBlock.stats.tokenCreations.toLocaleString(),
        },
    ];

    // Energy is optional noise on quiet blocks — only surface it when present.
    if (latestBlock.stats.totalEnergyUsed > 0) {
        metrics.push({
            key: 'energy',
            label: 'Energy',
            icon: Zap,
            value: formatCompactNumber(latestBlock.stats.totalEnergyUsed),
        });
    }

    return (
        <div className={styles.ticker}>
            <div className={styles.container}>
                {metrics.map((metric, index) => {
                    const Icon = metric.icon;

                    return (
                        <Fragment key={metric.key}>
                            {index > 0 && <div className={styles.separator} />}
                            <div className={styles.item} title={metric.label}>
                                <Icon
                                    className={cn(styles.icon, metric.primary && styles['icon--primary'])}
                                    size={14}
                                    aria-hidden="true"
                                />
                                <span className={styles.sr_only}>{`${metric.label}:`}</span>
                                <span className={cn(styles.value, metric.primary && styles['value--primary'])}>
                                    {metric.value}
                                </span>
                            </div>
                        </Fragment>
                    );
                })}
            </div>
        </div>
    );
}

/**
 * Formats large numbers with abbreviated suffixes for compact display.
 *
 * Converts numeric values into space-efficient abbreviated formats:
 * - 1,234 → "1.2K"
 * - 1,234,567 → "1.2M"
 * - 1,234,567,890 → "1.2B"
 *
 * Used in the ticker to keep metrics concise while remaining readable.
 * Numbers under 1,000 are displayed with full locale formatting.
 *
 * @param num - The number to format
 * @returns Formatted string with abbreviated suffix (K/M/B) or full number
 */
function formatCompactNumber(num: number): string {
    if (num >= 1_000_000_000) {
        return (num / 1_000_000_000).toFixed(1) + 'B';
    }
    if (num >= 1_000_000) {
        return (num / 1_000_000).toFixed(1) + 'M';
    }
    if (num >= 1_000) {
        return (num / 1_000).toFixed(1) + 'K';
    }
    return num.toLocaleString();
}
