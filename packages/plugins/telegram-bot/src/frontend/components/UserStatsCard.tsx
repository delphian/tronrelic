import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';

/**
 * User statistics data from backend API.
 */
interface IUserStats {
    totalUsers: number;
    activeUsers24h: number;
    totalCommands: number;
    subscriptionCounts: Record<string, number>;
}

/**
 * Props for UserStatsCard component.
 */
interface IUserStatsCardProps {
    context: IFrontendPluginContext;
}

/**
 * Displays Telegram bot user statistics.
 * Shows total users, activity metrics, and subscription breakdown.
 *
 * Why this component exists:
 * Admin needs visibility into bot usage to monitor adoption and identify issues.
 * This card provides at-a-glance metrics without overwhelming detail.
 */
export function UserStatsCard({ context }: IUserStatsCardProps) {
    const { ui, api } = context;
    const [stats, setStats] = React.useState<IUserStats | null>(null);
    const [loading, setLoading] = React.useState(true);
    const [error, setError] = React.useState<string | null>(null);

    /**
     * Fetches user statistics from backend API.
     *
     * Why async effect:
     * Statistics are calculated on-demand to avoid stale cached data.
     * Loading state provides feedback during API call.
     */
    React.useEffect(() => {
        async function fetchStats() {
            try {
                setLoading(true);
                setError(null);

                const response = await api.get<{ success: boolean; stats: IUserStats }>(
                    '/plugins/telegram-bot/system/stats'
                );

                if (response.success) {
                    setStats(response.stats);
                } else {
                    setError('Failed to load statistics');
                }
            } catch (err) {
                setError('Failed to fetch statistics');
                console.error('Error fetching Telegram stats:', err);
            } finally {
                setLoading(false);
            }
        }

        void fetchStats();
    }, [api]);

    if (loading) {
        return (
            <ui.Card>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>User Statistics</h3>
                <div>Loading...</div>
            </ui.Card>
        );
    }

    if (error || !stats) {
        return (
            <ui.Card>
                <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1rem' }}>User Statistics</h3>
                <p style={{ color: 'var(--color-danger)' }}>{error || 'No statistics available'}</p>
            </ui.Card>
        );
    }

    return (
        <ui.Card>
            <h3 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1.5rem' }}>User Statistics</h3>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Total users */}
                <div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                        Total Users
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                        {stats.totalUsers.toLocaleString()}
                    </div>
                </div>

                {/* Active users (24h) */}
                <div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                        Active Users (24h)
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                        {stats.activeUsers24h.toLocaleString()}
                    </div>
                </div>

                {/* Total commands */}
                <div>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)' }}>
                        Total Commands
                    </div>
                    <div style={{ fontSize: '1.5rem', fontWeight: 600 }}>
                        {stats.totalCommands.toLocaleString()}
                    </div>
                </div>

                {/* Subscription breakdown */}
                {Object.keys(stats.subscriptionCounts).length > 0 && (
                    <div>
                        <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem' }}>
                            Subscriptions
                        </div>
                        {Object.entries(stats.subscriptionCounts).map(([type, count]) => (
                            <div key={type} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.5rem' }}>
                                <span>{type}</span>
                                <ui.Badge tone="neutral">{count}</ui.Badge>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </ui.Card>
    );
}
