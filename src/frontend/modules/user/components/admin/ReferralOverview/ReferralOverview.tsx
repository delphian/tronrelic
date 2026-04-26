/**
 * ReferralOverview Component
 *
 * Admin dashboard for aggregate referral program metrics. Shows program-wide
 * stats (total referrals, conversions, active codes), top referrers ranked by
 * referred count, and recent referral activity.
 */

'use client';

import React, { useEffect, useState, useCallback } from 'react';
import { Users, UserCheck, Award, Link2 } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { adminGetReferralOverview } from '../../../api';
import type { AnalyticsPeriod, IReferralOverview } from '../../../api';
import styles from './ReferralOverview.module.scss';

/** Period options for the referral dashboard. */
const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
];

interface Props {
    /** Admin authentication token. */
    token: string;
}

/**
 * ReferralOverview renders aggregate referral program metrics.
 *
 * Fetches data from the referral-overview admin endpoint and displays
 * summary cards, a top referrers table, and a recent referrals table.
 * Period selector controls the "recent activity" window.
 *
 * @param props - Component props
 * @param props.token - Admin API token
 */
export function ReferralOverview({ token }: Props) {
    const [period, setPeriod] = useState<AnalyticsPeriod>('30d');
    const [data, setData] = useState<IReferralOverview | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(false);

    /**
     * Fetch referral overview data.
     */
    const fetchData = useCallback(async () => {
        setLoading(true);
        try {
            const result = await adminGetReferralOverview(token, { period });
            setData(result);
            setError(false);
        } catch (err) {
            console.error('Failed to fetch referral overview:', err);
            setData(null);
            setError(true);
        } finally {
            setLoading(false);
        }
    }, [token, period]);

    useEffect(() => {
        fetchData();
    }, [fetchData]);

    if (loading) {
        return <div className={styles.loading}>Loading referral data...</div>;
    }

    if (error || !data) {
        return <div className={styles.empty_state}>Failed to load referral data. Please try again.</div>;
    }

    return (
        <div className={styles.container}>
            {/* Period selector */}
            <div className={styles.controls}>
                <span className={styles.controls__label}>Period:</span>
                {PERIOD_OPTIONS.map(opt => (
                    <Button
                        key={opt.value}
                        variant={period === opt.value ? 'primary' : 'secondary'}
                        size="sm"
                        onClick={() => setPeriod(opt.value)}
                    >
                        {opt.label}
                    </Button>
                ))}
            </div>

            {/* Summary Cards */}
            <div className={styles.metrics_grid}>
                <div className={`surface ${styles.metric_card}`}>
                    <div className={styles.metric_card__value}>{data.totalReferrals.toLocaleString()}</div>
                    <div className={styles.metric_card__label}>
                        <Users size={12} className={styles.title_icon} />
                        Total Referred
                    </div>
                </div>
                <div className={`surface ${styles.metric_card}`}>
                    <div className={styles.metric_card__value}>{data.totalConverted.toLocaleString()}</div>
                    <div className={styles.metric_card__label}>
                        <UserCheck size={12} className={styles.title_icon} />
                        Wallets Verified
                    </div>
                </div>
                <div className={`surface ${styles.metric_card}`}>
                    <div className={styles.metric_card__value}>{data.conversionRate}%</div>
                    <div className={styles.metric_card__label}>Conversion Rate</div>
                </div>
                <div className={`surface ${styles.metric_card}`}>
                    <div className={styles.metric_card__value}>{data.usersWithCodes.toLocaleString()}</div>
                    <div className={styles.metric_card__label}>
                        <Link2 size={12} className={styles.title_icon} />
                        Active Codes
                    </div>
                </div>
            </div>

            {/* Top Referrers */}
            <section>
                <h3 className={styles.section_title}>
                    <Award size={16} className={styles.title_icon} />
                    Top Referrers
                </h3>
                {data.topReferrers.length === 0 ? (
                    <div className="surface surface--padding-md">
                        <div className={styles.empty_state}>No referrals recorded yet.</div>
                    </div>
                ) : (
                    <div className="surface surface--padding-sm">
                        <div className={styles.table_wrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>User ID</th>
                                        <th>Code</th>
                                        <th className={styles.table__number}>Referred</th>
                                        <th className={styles.table__number}>Converted</th>
                                        <th className={styles.table__number}>Conv %</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.topReferrers.map(r => (
                                        <tr key={r.code}>
                                            <td className={styles.table__mono}>{r.userId.slice(0, 12)}...</td>
                                            <td className={styles.table__mono}>{r.code}</td>
                                            <td className={styles.table__number}>{r.referredCount}</td>
                                            <td className={styles.table__number}>{r.convertedCount}</td>
                                            <td className={styles.table__number}>
                                                {r.referredCount > 0
                                                    ? `${Math.round((r.convertedCount / r.referredCount) * 100)}%`
                                                    : '—'}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>

            {/* Recent Referrals */}
            <section>
                <h3 className={styles.section_title}>
                    <Users size={16} className={styles.title_icon} />
                    Recent Referrals
                </h3>
                {data.recentReferrals.length === 0 ? (
                    <div className="surface surface--padding-md">
                        <div className={styles.empty_state}>No referrals in this period.</div>
                    </div>
                ) : (
                    <div className="surface surface--padding-sm">
                        <div className={styles.table_wrapper}>
                            <table className={styles.table}>
                                <thead>
                                    <tr>
                                        <th>Referred User</th>
                                        <th>Referred By</th>
                                        <th>When</th>
                                        <th>Verified</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {data.recentReferrals.map(r => (
                                        <tr key={r.userId}>
                                            <td className={styles.table__mono}>{r.userId.slice(0, 12)}...</td>
                                            <td className={styles.table__mono}>{r.referredBy}</td>
                                            <td>
                                                <ClientTime date={r.referredAt} format="relative" />
                                            </td>
                                            <td>
                                                <span className={`badge ${r.hasVerifiedWallet ? 'badge--success' : 'badge--neutral'}`}>
                                                    {r.hasVerifiedWallet ? 'Yes' : 'No'}
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                )}
            </section>
        </div>
    );
}
