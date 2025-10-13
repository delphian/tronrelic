'use client';

import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import styles from './AccountSummary.module.css';

/**
 * Energy resource snapshot for an account.
 */
export interface AccountEnergySnapshot {
    /** Total energy available to the account */
    total: number;
    /** Amount of energy delegated to others */
    delegated: number;
    /** Maximum energy limit for the account */
    limit: number;
    /** Amount of energy currently used */
    used: number;
    /** ISO timestamp of last update */
    lastUpdated?: string;
}

/**
 * Bandwidth resource snapshot for an account.
 */
export interface AccountBandwidthSnapshot {
    /** Maximum bandwidth limit for the account */
    limit: number;
    /** Amount of bandwidth currently used */
    used: number;
    /** ISO timestamp of last update */
    lastUpdated?: string;
}

/**
 * Complete account summary snapshot including balances, tags, and resources.
 */
export interface AccountSummarySnapshot {
    /** TRON wallet address (base58 format) */
    address: string;
    /** Optional account name/label */
    name?: string | null;
    /** ISO timestamp when account was created on-chain */
    createdAt?: string | null;
    /** Address that activated this account (sent first transaction) */
    activatedBy?: string | null;
    /** Current TRX balance */
    balanceTRX: number;
    /** Accumulated staking rewards in TRX */
    rewardsTRX?: number;
    /** Classification tags (e.g., "exchange", "whale", "contract") */
    tags?: string[];
    /** Risk assessment level for security monitoring */
    riskLevel?: 'low' | 'moderate' | 'high';
    /** Current energy resource snapshot */
    energy?: AccountEnergySnapshot;
    /** Current bandwidth resource snapshot */
    bandwidth?: AccountBandwidthSnapshot;
}

/**
 * Properties for the AccountSummary component.
 */
interface AccountSummaryProps {
    /** Account data snapshot to display */
    snapshot: AccountSummarySnapshot;
}

/**
 * AccountSummary - Displays comprehensive account information and resource usage
 *
 * Shows key account metrics including:
 * - Address, name, and classification tags
 * - Risk level badges for security monitoring
 * - TRX balance and staking rewards
 * - Account creation and activation details
 * - Energy and bandwidth resource usage with visual progress bars
 *
 * The component adapts to show only available data, gracefully handling
 * missing optional fields like rewards or resource snapshots.
 *
 * @param props - Component properties with account snapshot data
 * @returns A card containing formatted account information and resource meters
 */
export function AccountSummary({ snapshot }: AccountSummaryProps) {
    return (
        <Card padding="lg">
            <div className={styles.container}>
                <header className={styles.header}>
                    <div className={styles.header__info}>
                        <h2 className={styles.header__address}>{snapshot.address}</h2>
                        {snapshot.name && <p className={styles.header__name}>{snapshot.name}</p>}
                    </div>
                    <div className={styles.header__badges}>
                        {snapshot.tags?.map(tag => (
                            <Badge tone="neutral" key={tag}>{tag}</Badge>
                        ))}
                        {snapshot.riskLevel === 'high' && <Badge tone="danger">High risk</Badge>}
                        {snapshot.riskLevel === 'moderate' && <Badge tone="warning">Moderate risk</Badge>}
                    </div>
                </header>

                <section className={styles['metrics-grid']}>
                    <Metric label="Balance" value={`${snapshot.balanceTRX.toLocaleString(undefined, { maximumFractionDigits: 2 })} TRX`} />
                    <Metric label="Rewards" value={`${(snapshot.rewardsTRX ?? 0).toLocaleString(undefined, { maximumFractionDigits: 2 })} TRX`} />
                    <Metric label="Created" value={snapshot.createdAt ? new Date(snapshot.createdAt).toLocaleDateString() : 'Unknown'} />
                    <Metric label="Activated by" value={snapshot.activatedBy ?? 'Unknown'} muted />
                </section>

                <section className={styles['resources-grid']}>
                    {snapshot.energy && (
                        <ResourceCard
                            title="Energy"
                            total={snapshot.energy.total}
                            used={snapshot.energy.used}
                            delegated={snapshot.energy.delegated}
                            limit={snapshot.energy.limit}
                            lastUpdated={snapshot.energy.lastUpdated}
                        />
                    )}
                    {snapshot.bandwidth && (
                        <ResourceCard
                            title="Bandwidth"
                            total={snapshot.bandwidth.limit}
                            used={snapshot.bandwidth.used}
                            limit={snapshot.bandwidth.limit}
                            lastUpdated={snapshot.bandwidth.lastUpdated}
                        />
                    )}
                </section>
            </div>
        </Card>
    );
}

/**
 * Properties for the Metric component.
 */
interface MetricProps {
    /** Metric label (e.g., "Balance", "Rewards") */
    label: string;
    /** Formatted metric value */
    value: string;
    /** If true, displays value in smaller, muted styling */
    muted?: boolean;
}

/**
 * Metric - Displays a labeled metric value
 *
 * Used for displaying account statistics like balance, rewards, and timestamps.
 * Supports muted styling for less prominent metrics like "Activated by".
 *
 * @param props - Metric label, value, and optional muted flag
 * @returns A formatted metric display element
 */
function Metric({ label, value, muted }: MetricProps) {
    return (
        <div>
            <div className={styles.metric__label}>{label}</div>
            <strong className={muted ? styles['metric__value--muted'] : styles.metric__value}>{value}</strong>
        </div>
    );
}

/**
 * Properties for the ResourceCard component.
 */
interface ResourceCardProps {
    /** Resource type name (e.g., "Energy", "Bandwidth") */
    title: string;
    /** Total resource amount available */
    total: number;
    /** Amount currently used */
    used: number;
    /** Amount delegated to others (optional, energy only) */
    delegated?: number;
    /** Maximum resource limit */
    limit: number;
    /** ISO timestamp of last resource update */
    lastUpdated?: string;
}

/**
 * ResourceCard - Displays resource usage with progress bar and details
 *
 * Shows TRON resource consumption (energy or bandwidth) with:
 * - Visual progress bar indicating usage percentage
 * - Detailed breakdown of total, used, limit, and delegated amounts
 * - Last update timestamp for data freshness
 *
 * Calculates usage percentage and clamps it between 0-100% to handle
 * edge cases where used exceeds limit during resource regeneration.
 *
 * @param props - Resource title, usage values, and timestamps
 * @returns A card displaying resource consumption metrics
 */
function ResourceCard({
    title,
    total,
    used,
    delegated,
    limit,
    lastUpdated
}: ResourceCardProps) {
    /**
     * Calculates the percentage of resource used, clamped to 0-100 range.
     * Handles division by zero when limit is 0.
     */
    const percentage = limit > 0 ? Math.min(100, Math.max(0, Math.round((used / limit) * 100))) : 0;

    return (
        <div className={styles['resource-card']}>
            <div className={styles['resource-card__header']}>
                <h3 className={styles['resource-card__title']}>{title}</h3>
                <span className={styles['resource-card__percentage']}>{percentage}% used</span>
            </div>
            <div className={styles['resource-card__progress']}>
                <Progress value={percentage} />
            </div>
            <ul className={styles['resource-card__details']}>
                <li>Total: {total.toLocaleString()}</li>
                <li>Used: {used.toLocaleString()}</li>
                <li>Limit: {limit.toLocaleString()}</li>
                {delegated != null && <li>Delegated: {delegated.toLocaleString()}</li>}
                {lastUpdated && <li>Updated: {new Date(lastUpdated).toLocaleTimeString()}</li>}
            </ul>
        </div>
    );
}

/**
 * Properties for the Progress component.
 */
interface ProgressProps {
    /** Percentage value (0-100) to display in the progress bar */
    value: number;
}

/**
 * Progress - Horizontal progress bar component
 *
 * Displays a gradient-filled progress bar indicating resource usage percentage.
 * The bar width animates smoothly when the value changes.
 *
 * @param props - Percentage value (0-100) to display
 * @returns A horizontal progress bar element
 */
function Progress({ value }: ProgressProps) {
    return (
        <div className={styles.progress}>
            <div
                className={styles.progress__bar}
                style={{ width: `${value}%` }}
            />
        </div>
    );
}
