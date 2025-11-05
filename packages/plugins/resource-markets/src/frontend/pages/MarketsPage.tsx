'use client';

import { useState, useEffect } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import type { MarketDocument } from '@tronrelic/shared';
import { MarketDashboard } from '../components/MarketDashboard';
import styles from './MarketsPage.module.css';

/**
 * Main page for the Resource Markets plugin displaying energy market comparison.
 *
 * This page fetches market data from the plugin's REST API endpoint and displays
 * it in a comprehensive dashboard with real-time WebSocket updates. It replaces
 * the old core module's market page with a plugin-based implementation that uses
 * dependency injection for all UI components and API access.
 *
 * The page handles loading states, errors, and provides a manual refresh button
 * for users who want to fetch the latest data immediately without waiting for
 * the WebSocket update interval.
 *
 * @param context - Frontend plugin context providing UI components, API client, and WebSocket access
 * @returns A fully interactive energy markets dashboard page
 */
export function MarketsPage({ context }: { context: IFrontendPluginContext }) {
    const { ui, api } = context;
    const [markets, setMarkets] = useState<MarketDocument[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [refreshing, setRefreshing] = useState(false);

    /**
     * Fetches market data from the plugin's REST API endpoint.
     *
     * Makes a GET request to `/plugins/resource-markets/markets` and updates
     * local state with the response. Handles loading states and error messages to
     * provide feedback during data fetching.
     *
     * The api.get() method is already configured with the '/api' base path, so we
     * only need to provide the plugin-specific path segment.
     *
     * This function is called on initial mount and can be manually triggered by the
     * refresh button to fetch the latest pricing data before the next scheduled update.
     */
    const loadMarkets = async () => {
        try {
            setLoading(true);
            setError(null);

            const response = await api.get('/plugins/resource-markets/markets');

            if (response.success && response.markets) {
                setMarkets(response.markets);
            } else {
                setError('Failed to load markets: Invalid response format');
            }
        } catch (err) {
            console.error('Market fetch error:', err);
            setError(err instanceof Error ? err.message : 'Unknown error occurred');
        } finally {
            setLoading(false);
        }
    };

    /**
     * Handles manual refresh button clicks.
     *
     * Fetches fresh market data and provides visual feedback during the refresh
     * operation. Uses separate refreshing state to differentiate between initial
     * load and manual refresh, allowing the UI to show appropriate loading indicators.
     */
    const handleRefresh = async () => {
        setRefreshing(true);
        await loadMarkets();
        setRefreshing(false);
    };

    // Load markets on mount
    useEffect(() => {
        void loadMarkets();
    }, []);

    /**
     * Subscribes to real-time market updates via WebSocket.
     *
     * When the backend emits market data changes (every 10 minutes from the refresh job),
     * this subscription receives the updates and refreshes the local state automatically.
     * The subscription is automatically namespaced to 'plugin:resource-markets:update' by
     * the plugin WebSocket manager.
     *
     * Initial data is received via the 'initial' event immediately after joining the room.
     */
    useEffect(() => {
        if (!context.websocket) {
            return;
        }

        // Handler for real-time market updates
        const handleUpdate = (payload: { markets: MarketDocument[]; timestamp: string }) => {
            setMarkets(payload.markets);
        };

        // Handler for initial data event (sent when joining room)
        const handleInitial = (payload: { markets: MarketDocument[]; timestamp: string }) => {
            setMarkets(payload.markets);
        };

        // Subscribe to events (automatically prefixed with plugin ID)
        context.websocket.on('update', handleUpdate);
        context.websocket.on('initial', handleInitial);

        // Join the market-updates room
        context.websocket.subscribe('market-updates');

        return () => {
            // Cleanup subscriptions
            context.websocket.off('update', handleUpdate);
            context.websocket.off('initial', handleInitial);
            context.websocket.unsubscribe('market-updates');
        };
    }, [context.websocket]);

    // Show loading skeleton during initial fetch
    if (loading && markets.length === 0) {
        return (
            <div className={styles.page}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Energy Markets</h1>
                    <p className={styles.description}>Real-time TRON energy market comparison</p>
                </div>
                <ui.Card>
                    <ui.Skeleton height={400} />
                </ui.Card>
            </div>
        );
    }

    // Show error state with retry button
    if (error) {
        return (
            <div className={styles.page}>
                <div className={styles.header}>
                    <h1 className={styles.title}>Energy Markets</h1>
                    <p className={styles.description}>Real-time TRON energy market comparison</p>
                </div>
                <ui.Card>
                    <div className={styles.error_container}>
                        <p className={styles.error_message}>{error}</p>
                        <ui.Button onClick={handleRefresh} variant="primary">
                            Retry
                        </ui.Button>
                    </div>
                </ui.Card>
            </div>
        );
    }

    // Show main dashboard with market data
    return (
        <div className={styles.page}>
            <div className={styles.header}>
                <div className={styles.header_content}>
                    <h1 className={styles.title}>Energy Markets</h1>
                    <p className={styles.description}>Real-time TRON energy market comparison</p>
                </div>
                <ui.Button
                    onClick={handleRefresh}
                    variant="secondary"
                    loading={refreshing}
                    disabled={refreshing}
                >
                    Refresh
                </ui.Button>
            </div>
            <MarketDashboard context={context} markets={markets} />
        </div>
    );
}
