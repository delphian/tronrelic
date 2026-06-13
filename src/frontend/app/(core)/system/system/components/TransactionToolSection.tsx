'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { StatStrip } from './StatStrip';
import styles from './TransactionToolSection.module.scss';

/** Mirrors the backend `ITransactionToolStats` shape. */
interface TransactionToolStats {
    invocations: number;
    allowed: number;
    rateLimited: number;
    invalidInput: number;
    resolved: number;
    notFound: number;
    window: {
        limit: number;
        windowMs: number;
        used: number;
        remaining: number;
        resetInMs: number;
    };
    lastInvocationAt: string | null;
    lastRateLimitedAt: string | null;
}

/**
 * Usage and safeguard readout for the core `tronrelic-get-transaction` AI tool.
 *
 * Polls the admin stats endpoint and renders three StatStrip blocks — request
 * throughput, lookup outcomes, and the global rate-limiter window — so an
 * operator can see at a glance how often the tool runs, how many calls the
 * limiter rejects, and how much budget remains in the current window.
 */
export function TransactionToolSection() {
    const [stats, setStats] = useState<TransactionToolStats | null>(null);
    const [error, setError] = useState<string | null>(null);

    const fetchData = useCallback(async () => {
        try {
            const response = await fetch('/api/admin/system/blockchain/transaction-tool/stats');
            if (!response.ok) {
                throw new Error(`Transaction tool stats unavailable (status ${response.status})`);
            }
            setStats((await response.json()).stats ?? null);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch transaction tool stats');
        }
    }, []);

    useEffect(() => {
        void fetchData();
        const interval = setInterval(() => void fetchData(), 10000);
        return () => clearInterval(interval);
    }, [fetchData]);

    return (
        <div className={styles.subsection}>
            {error && (
                <div className="alert alert--danger" role="alert">
                    <span className={styles.error_inline}>
                        <AlertCircle size={14} aria-hidden="true" />
                        {error}
                    </span>
                </div>
            )}

            {stats && (
                <>
                    <div className={styles.block}>
                        <header className={styles.block_header}>
                            <h4 className={styles.block_title}>Request Throughput</h4>
                            {stats.lastInvocationAt && (
                                <span className={styles.block_note}>
                                    Last call: <ClientTime date={stats.lastInvocationAt} format="datetime" />
                                </span>
                            )}
                        </header>
                        <StatStrip
                            items={[
                                { label: 'Invocations', value: stats.invocations.toLocaleString(), detail: 'Total since boot' },
                                { label: 'Allowed', value: stats.allowed.toLocaleString(), detail: 'Passed the limiter' },
                                {
                                    label: 'Rate Limited',
                                    value: stats.rateLimited.toLocaleString(),
                                    detail: 'Rejected by limiter',
                                    tone: stats.rateLimited > 0 ? 'warning' : 'neutral'
                                },
                                {
                                    label: 'Invalid Input',
                                    value: stats.invalidInput.toLocaleString(),
                                    detail: 'Malformed txId',
                                    tone: stats.invalidInput > 0 ? 'danger' : 'neutral'
                                }
                            ]}
                        />
                    </div>

                    <div className={styles.block}>
                        <h4 className={styles.block_title}>Lookup Outcomes</h4>
                        <StatStrip
                            items={[
                                { label: 'Resolved', value: stats.resolved.toLocaleString(), detail: 'Transaction found' },
                                { label: 'Not Found', value: stats.notFound.toLocaleString(), detail: 'No transaction' },
                                {
                                    label: 'Resolve Rate',
                                    value: stats.allowed > 0
                                        ? `${((stats.resolved / stats.allowed) * 100).toFixed(1)}%`
                                        : '—',
                                    detail: 'Resolved / allowed'
                                }
                            ]}
                        />
                    </div>

                    <div className={styles.block}>
                        <header className={styles.block_header}>
                            <h4 className={styles.block_title}>Rate Limiter Window</h4>
                            {stats.lastRateLimitedAt && (
                                <span className={styles.block_note}>
                                    Last rejection: <ClientTime date={stats.lastRateLimitedAt} format="datetime" />
                                </span>
                            )}
                        </header>
                        <StatStrip
                            items={[
                                {
                                    label: 'Limit',
                                    value: `${stats.window.limit}`,
                                    detail: `Per ${Math.round(stats.window.windowMs / 1000)}s window`
                                },
                                { label: 'Used', value: `${stats.window.used}`, detail: 'This window' },
                                {
                                    label: 'Remaining',
                                    value: `${stats.window.remaining}`,
                                    detail: 'Budget left',
                                    tone: getRemainingTone(stats.window.remaining, stats.window.limit)
                                },
                                {
                                    label: 'Resets In',
                                    value: stats.window.resetInMs > 0
                                        ? `${Math.ceil(stats.window.resetInMs / 1000)}s`
                                        : 'now'
                                }
                            ]}
                        />
                    </div>
                </>
            )}
        </div>
    );
}

/**
 * Tone for the remaining-budget cell: danger when exhausted, warning when
 * under a fifth of the window remains, otherwise success.
 */
function getRemainingTone(remaining: number, limit: number): 'success' | 'warning' | 'danger' {
    if (remaining <= 0) return 'danger';
    if (remaining < limit * 0.2) return 'warning';
    return 'success';
}
