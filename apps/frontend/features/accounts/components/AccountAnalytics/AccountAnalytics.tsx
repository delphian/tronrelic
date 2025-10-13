'use client';

import { useMemo } from 'react';
import { LineChart, type ChartSeries } from '../../../charts/components/LineChart';
import type { TimeseriesPoint } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import styles from './AccountAnalytics.module.css';

/**
 * Properties for the AccountAnalytics component.
 */
interface AccountAnalyticsProps {
    /** Time-series data for TRX inflows to the account */
    inflows: TimeseriesPoint[];
    /** Time-series data for TRX outflows from the account */
    outflows: TimeseriesPoint[];
    /** Optional time-series data for net transfer balance (inflows - outflows) */
    netTransfers?: TimeseriesPoint[];
}

/**
 * AccountAnalytics - Displays daily inflow and outflow trends for a TRON account
 *
 * Visualizes account activity patterns to identify:
 * - Accumulation behavior (consistent inflows)
 * - Distribution patterns (consistent outflows)
 * - Arbitrage activity (balanced inflows/outflows)
 * - Net transfer trends over time
 *
 * The component transforms raw time-series data into chart series with
 * distinct colors for each metric type.
 *
 * @param props - Component properties including inflow, outflow, and net transfer data
 * @returns A card containing a multi-series line chart of account analytics
 */
export function AccountAnalytics({ inflows, outflows, netTransfers = [] }: AccountAnalyticsProps) {
    /**
     * Transforms time-series point arrays into chart series with labels and colors.
     * Memoized to prevent unnecessary recalculation when component re-renders.
     */
    const series = useMemo<ChartSeries[]>(() => {
        const composed: ChartSeries[] = [];
        if (inflows.length) {
            composed.push({
                id: 'inflows',
                label: 'Inflows (TRX)',
                data: inflows.map(point => ({ date: point.date, value: point.value })),
                color: '#65D9A5'
            });
        }
        if (outflows.length) {
            composed.push({
                id: 'outflows',
                label: 'Outflows (TRX)',
                data: outflows.map(point => ({ date: point.date, value: point.value })),
                color: '#FF9F6E'
            });
        }
        if (netTransfers.length) {
            composed.push({
                id: 'net',
                label: 'Net transfers',
                data: netTransfers.map(point => ({ date: point.date, value: point.value })),
                color: '#7C9BFF',
                fill: false
            });
        }
        return composed;
    }, [inflows, netTransfers, outflows]);

    return (
        <Card padding="lg">
            <div className={styles.container}>
                <header className={styles.header}>
                    <h2 className={styles.header__title}>Account analytics</h2>
                    <p className={styles.header__description}>
                        Daily inflow and outflow trends help spot accumulation, distribution, and arbitrage behaviour.
                    </p>
                </header>
                <LineChart
                    series={series}
                    height={320}
                    yAxisFormatter={value => `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} TRX`}
                    xAxisFormatter={date => date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    emptyLabel="Analytics will populate after the historical sync completes for this account."
                />
            </div>
        </Card>
    );
}
