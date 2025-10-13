'use client';

import { useMemo } from 'react';
import type { TronTransactionDocument } from '@tronrelic/shared';
import { Card } from '../../../../components/ui/Card';
import { Badge } from '../../../../components/ui/Badge';
import { cn } from '../../../../lib/cn';
import styles from './TransactionDetails.module.css';

/**
 * Properties for the TransactionDetails component.
 */
interface TransactionDetailsProps {
    /** Complete transaction document to display */
    transaction: TronTransactionDocument;
}

/**
 * TransactionDetails - Comprehensive transaction information display
 *
 * Shows detailed breakdown of a TRON blockchain transaction including:
 * - **Header** - Transaction type badge and timestamp
 * - **Primary metrics** - TRX/USD values, sender, recipient addresses
 * - **Memo** - Optional transaction message (if present)
 * - **Resource usage** - Energy and bandwidth consumption with costs
 * - **Contract details** - Smart contract address and method (if applicable)
 * - **Analysis** - Pattern detection, risk score, related addresses (if available)
 *
 * The component dynamically shows/hides sections based on transaction data:
 * - Memo section only appears if transaction has a memo
 * - USD value only shown if available
 * - Contract details only shown for contract interactions
 * - Analysis section only shown if analysis data exists
 *
 * Resource costs are calculated from consumed units multiplied by unit price.
 * Transaction types are formatted from camelCase to Title Case for readability.
 *
 * @param props - Component properties with transaction document
 * @returns A card displaying complete transaction details
 */
export function TransactionDetails({ transaction }: TransactionDetailsProps) {
    const energyCost = transaction.energy?.totalCost ?? 0;
    const bandwidthCost = transaction.bandwidth?.totalCost ?? 0;

    /**
     * Formats transaction type for display.
     * Converts camelCase to spaced Title Case (e.g., "TransferContract" → "Transfer Contract").
     * Memoized to avoid recalculation on re-renders.
     */
    const formattedType = useMemo(() => {
        const base = transaction.type.replace(/([A-Z])/g, ' $1').trim();
        return base.charAt(0).toUpperCase() + base.slice(1);
    }, [transaction.type]);

    return (
        <Card padding="lg">
            <div className={styles.container}>
                <header className={styles.header}>
                    <div className={styles.header__info}>
                        <h2 className={styles.header__title}>Transaction details</h2>
                        <p className={styles.header__timestamp}>
                            {new Date(transaction.timestamp).toLocaleString()}
                        </p>
                    </div>
                    <Badge tone="neutral">{formattedType}</Badge>
                </header>

                <section className={styles.metrics_grid}>
                    <Metric label="TRX value" value={`${transaction.amountTRX.toLocaleString()} TRX`} />
                    {transaction.amountUSD != null && (
                        <Metric
                            label="USD value"
                            value={`$${transaction.amountUSD.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                        />
                    )}
                    <Metric label="From" value={transaction.from.address} muted />
                    <Metric label="To" value={transaction.to.address} muted />
                </section>

                {transaction.memo && (
                    <section className={styles.memo_section}>
                        <div className={styles.memo_section__label}>Memo</div>
                        <code className={styles.memo_section__content}>{transaction.memo}</code>
                    </section>
                )}

                <section className={styles.stats_grid}>
                    <StatBlock
                        title="Energy"
                        primary={transaction.energy ? `${transaction.energy.consumed.toLocaleString()} units` : '—'}
                        secondary={transaction.energy ? `${energyCost.toFixed(2)} TRX` : ''}
                    />
                    <StatBlock
                        title="Bandwidth"
                        primary={transaction.bandwidth ? `${transaction.bandwidth.consumed.toLocaleString()} units` : '—'}
                        secondary={transaction.bandwidth ? `${bandwidthCost.toFixed(2)} TRX` : ''}
                    />
                    {transaction.contract && (
                        <StatBlock
                            title="Contract"
                            primary={transaction.contract.address}
                            secondary={transaction.contract.method ?? ''}
                        />
                    )}
                </section>

                {transaction.analysis && (
                    <section className={styles.analysis_section}>
                        <div className={styles.analysis_section__label}>Analysis</div>
                        <ul className={styles.analysis_section__list}>
                            {transaction.analysis.pattern && (
                                <li>Pattern detected: {transaction.analysis.pattern.replace('_', ' ')}</li>
                            )}
                            {transaction.analysis.riskScore != null && (
                                <li>Risk score: {transaction.analysis.riskScore}</li>
                            )}
                            {transaction.analysis.relatedAddresses?.length && (
                                <li>Related wallets: {transaction.analysis.relatedAddresses.join(', ')}</li>
                            )}
                        </ul>
                    </section>
                )}
            </div>
        </Card>
    );
}

/**
 * Properties for the Metric component.
 */
interface MetricProps {
    /** Metric label (e.g., "TRX value", "From") */
    label: string;
    /** Formatted metric value */
    value: string;
    /** If true, displays value in smaller, muted styling */
    muted?: boolean;
}

/**
 * Metric - Displays a labeled metric value
 *
 * Used for showing key transaction properties like amounts and addresses.
 * Supports muted styling for less prominent metrics (e.g., addresses).
 *
 * @param props - Metric label, value, and optional muted flag
 * @returns A formatted metric display element
 */
function Metric({ label, value, muted }: MetricProps) {
    return (
        <div>
            <div className={styles.metric__label}>{label}</div>
            <strong className={cn(
                styles.metric__value,
                muted && styles['metric__value--muted']
            )}>
                {value}
            </strong>
        </div>
    );
}

/**
 * Properties for the StatBlock component.
 */
interface StatBlockProps {
    /** Block title (e.g., "Energy", "Bandwidth", "Contract") */
    title: string;
    /** Primary value to display */
    primary: string;
    /** Optional secondary value (e.g., cost or method name) */
    secondary?: string;
}

/**
 * StatBlock - Displays a titled statistic block with primary and secondary values
 *
 * Used for showing resource usage metrics with consumption and cost,
 * or contract details with address and method name.
 *
 * @param props - Block title, primary value, and optional secondary value
 * @returns A formatted statistics block element
 */
function StatBlock({ title, primary, secondary }: StatBlockProps) {
    return (
        <div className={styles.stat_block}>
            <div className={styles.stat_block__title}>{title}</div>
            <strong className={styles.stat_block__primary}>{primary}</strong>
            {secondary && <div className={styles.stat_block__secondary}>{secondary}</div>}
        </div>
    );
}
