'use client';

import { useState, useEffect } from 'react';
import { config } from '../../../lib/config';

/**
 * Individual data point in the transaction timeseries.
 */
interface TimeseriesPoint {
    /** ISO timestamp or formatted date string */
    date: string;
    /** Total transactions in this time bucket */
    transactions: number;
    /** Average transactions per block in this time bucket */
    avgPerBlock: number;
}

/**
 * API response shape for transaction timeseries endpoint.
 */
interface TimeseriesResponse {
    success: boolean;
    data: TimeseriesPoint[];
    error?: string;
}

/**
 * Hook return value with data, loading, and error states.
 */
interface UseTransactionTimeseriesResult {
    /** Timeseries data points, or null if not yet loaded */
    data: TimeseriesPoint[] | null;
    /** True while fetching from API */
    loading: boolean;
    /** Error message if fetch failed, null otherwise */
    error: string | null;
    /** Manually trigger a refetch of the data */
    refetch: () => void;
}

/**
 * Fetches transaction count timeseries data from the backend API.
 *
 * This hook retrieves aggregated transaction statistics grouped by time windows
 * for charting purposes. The backend automatically adjusts grouping granularity:
 * - 1 day: hourly buckets (24 points)
 * - 7 days: hourly buckets (168 points)
 * - 30 days: 4-hour windows (180 points)
 *
 * The hook manages loading, error, and data states, and automatically fetches
 * data when the component mounts or when the days parameter changes. It also
 * provides a manual refetch function for user-triggered updates.
 *
 * @param days - Number of days of history to retrieve (min 1, max 90)
 * @returns Object containing data, loading state, error state, and refetch function
 *
 * @example
 * ```tsx
 * function TransactionChart() {
 *   const { data, loading, error } = useTransactionTimeseries(7);
 *
 *   if (loading) return <div>Loading...</div>;
 *   if (error) return <div>Error: {error}</div>;
 *   if (!data) return null;
 *
 *   return <LineChart series={[{
 *     id: 'transactions',
 *     label: 'Transactions',
 *     data: data.map(point => ({ date: point.date, value: point.transactions }))
 *   }]} />;
 * }
 * ```
 */
export function useTransactionTimeseries(days: number): UseTransactionTimeseriesResult {
    const [data, setData] = useState<TimeseriesPoint[] | null>(null);
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [fetchTrigger, setFetchTrigger] = useState<number>(0);

    useEffect(() => {
        let cancelled = false;

        async function fetchData() {
            setLoading(true);
            setError(null);

            try {
                const url = `${config.apiBaseUrl}/blockchain/transactions/timeseries?days=${days}`;

                const response = await fetch(url);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                const json = (await response.json()) as TimeseriesResponse;

                if (!cancelled) {
                    if (json.success && json.data) {
                        setData(json.data);
                    } else {
                        throw new Error(json.error || 'Failed to fetch transaction timeseries');
                    }
                }
            } catch (err) {
                if (!cancelled) {
                    const message = err instanceof Error ? err.message : 'Unknown error occurred';
                    setError(message);
                    setData(null);
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        }

        fetchData();

        return () => {
            cancelled = true;
        };
    }, [days, fetchTrigger]);

    const refetch = () => {
        setFetchTrigger(prev => prev + 1);
    };

    return { data, loading, error, refetch };
}
