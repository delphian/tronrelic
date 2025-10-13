'use client';

import { useEffect, useState } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { WhaleDashboard } from './whales/components/WhaleDashboard';

interface TimeseriesPoint {
    date: string;
    volume: number;
    max: number;
    count: number;
}

interface WhaleHighlightRecord {
    txId: string;
    timestamp: Date;
    amountTRX: number;
    fromAddress: string;
    toAddress: string;
    memo?: string;
}

/**
 * Whale Intelligence Page Component.
 *
 * Displays whale transaction analytics including timeseries charts
 * and recent whale activity highlights. Fetches data from the
 * whale-alerts plugin API endpoints using the injected API client.
 *
 * @param props - Component props
 * @param props.context - Frontend plugin context with API client and UI components
 */
export function WhaleIntelligencePage({ context }: { context: IFrontendPluginContext }) {
    const [series, setSeries] = useState<TimeseriesPoint[]>([]);
    const [highlights, setHighlights] = useState<WhaleHighlightRecord[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadData() {
            try {
                // Use injected API client instead of raw fetch
                const timeseriesData = await context.api.get('/plugins/whale-alerts/timeseries', { days: 14 });
                const highlightsData = await context.api.get('/plugins/whale-alerts/highlights', { limit: 12 });

                // Map API response to include 'value' field required by LineChart
                const transformedSeries = (timeseriesData.series || []).map((point: any) => ({
                    ...point,
                    value: point.volume || 0
                }));

                setSeries(transformedSeries);
                setHighlights(highlightsData.highlights || []);
            } catch (error) {
                console.error('Failed to load whale data:', error);
            } finally {
                setLoading(false);
            }
        }

        void loadData();
    }, [context.api]);

    if (loading) {
        return (
            <main>
                <div className="whale-page">
                    <section className="whale-page__header">
                        <h1 className="whale-page__title">Whale intelligence</h1>
                        <p className="whale-page__subtitle">Loading whale activity data...</p>
                    </section>
                </div>
            </main>
        );
    }

    return (
        <main>
            <div className="whale-page">
                <section className="whale-page__header">
                    <h1 className="whale-page__title">Whale intelligence</h1>
                    <p className="whale-page__subtitle">Monitor high-value transfers and spot accumulation or distribution trends instantly.</p>
                </section>
                <WhaleDashboard initialSeries={series} initialHighlights={highlights} context={context} />
            </div>
        </main>
    );
}
