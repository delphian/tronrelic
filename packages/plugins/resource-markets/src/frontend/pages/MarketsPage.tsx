'use client';

import { useState, useEffect } from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import type { MarketDocument } from '@tronrelic/shared';
import { Zap, Send, Globe, ExternalLink } from 'lucide-react';
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
                <section className={styles.page_header}>
                    <div className={styles.title_row}>
                        <h1 className={styles.title}>
                            <Zap className={styles.title_icon} size={64} />
                            Energy Markets
                        </h1>
                        <div className={styles.cta_buttons}>
                            <a
                                href="https://t.me/BuyEnergyTronsave_bot?start=tcrq2fjvon5mphjg"
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.cta_link}
                            >
                                <Send size={18} />
                                <span>Rent Energy via Bot</span>
                                <ExternalLink size={14} />
                            </a>
                            <a
                                href="https://tronsave.io/?ref=tcrq2fjvon5mphjg"
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.cta_link}
                            >
                                <Globe size={18} />
                                <span>Rent Energy via Web</span>
                                <ExternalLink size={14} />
                            </a>
                        </div>
                    </div>
                    <p className={styles.subtitle}>
                        Rent TRON energy at the cheapest rates across 20+ platforms and save up to 90% on USDT TRC20 transfer fees.
                        Compare real-time pricing from top energy rental marketplaces including TronSave, JustLend DAO, and CatFee to
                        find the best deals for your transactions. Live price tracking updates every 10 minutes to ensure you always
                        get the lowest cost per energy unit.
                    </p>
                </section>
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
                <section className={styles.page_header}>
                    <div className={styles.title_row}>
                        <h1 className={styles.title}>
                            <Zap className={styles.title_icon} size={64} />
                            Energy Markets
                        </h1>
                        <div className={styles.cta_buttons}>
                            <a
                                href="https://t.me/BuyEnergyTronsave_bot?start=tcrq2fjvon5mphjg"
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.cta_link}
                            >
                                <Send size={18} />
                                <span>Rent Energy via Bot</span>
                                <ExternalLink size={14} />
                            </a>
                            <a
                                href="https://tronsave.io/?ref=tcrq2fjvon5mphjg"
                                target="_blank"
                                rel="noopener noreferrer"
                                className={styles.cta_link}
                            >
                                <Globe size={18} />
                                <span>Rent Energy via Web</span>
                                <ExternalLink size={14} />
                            </a>
                        </div>
                    </div>
                    <p className={styles.subtitle}>
                        Rent TRON energy at the cheapest rates across 20+ platforms and save up to 90% on USDT TRC20 transfer fees.
                        Compare real-time pricing from top energy rental marketplaces including TronSave, JustLend DAO, and CatFee to
                        find the best deals for your transactions. Live price tracking updates every 10 minutes to ensure you always
                        get the lowest cost per energy unit.
                    </p>
                </section>
                <ui.Card>
                    <div className={styles.error_container}>
                        <p className={styles.error_message}>{error}</p>
                        <ui.Button onClick={() => void loadMarkets()} variant="primary">
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
            <section className={styles.page_header}>
                <div className={styles.title_row}>
                    <h1 className={styles.title}>
                        <Zap className={styles.title_icon} size={64} />
                        Energy Markets
                    </h1>
                    <div className={styles.cta_buttons}>
                        <a
                            href="https://t.me/BuyEnergyTronsave_bot?start=tcrq2fjvon5mphjg"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.cta_link}
                        >
                            <Send size={18} />
                            <span>Rent Energy via Bot</span>
                            <ExternalLink size={14} />
                        </a>
                        <a
                            href="https://tronsave.io/?ref=tcrq2fjvon5mphjg"
                            target="_blank"
                            rel="noopener noreferrer"
                            className={styles.cta_link}
                        >
                            <Globe size={18} />
                            <span>Rent Energy via Web</span>
                            <ExternalLink size={14} />
                        </a>
                    </div>
                </div>
                <p className={styles.subtitle}>
                    Rent TRON energy at the cheapest rates across 20+ platforms and save up to 90% on USDT TRC20 transfer fees.
                    Compare real-time pricing from top energy rental marketplaces including TronSave, JustLend DAO, and CatFee to
                    find the best deals for your transactions. Live price tracking updates every 10 minutes to ensure you always
                    get the lowest cost per energy unit.
                </p>
            </section>
            <MarketDashboard context={context} markets={markets} />
        </div>
    );
}
