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
 * Displays Telegram bot user statistics as individual metric cards.
 * Shows total users, active users (24h), and total commands as separate cards
 * in a horizontal row for at-a-glance monitoring.
 *
 * Why individual cards instead of grouped:
 * Separating metrics into individual cards makes each stat more prominent and
 * scannable at a glance. This pattern is common in dashboard UIs where quick
 * metric comparison is important.
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
            <>
                <ui.Card>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                        Total Users
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>--</div>
                </ui.Card>
                <ui.Card>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                        Active (24h)
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>--</div>
                </ui.Card>
                <ui.Card>
                    <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                        Total Commands
                    </div>
                    <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>--</div>
                </ui.Card>
            </>
        );
    }

    if (error || !stats) {
        return (
            <ui.Card style={{ gridColumn: '1 / -1' }}>
                <p style={{ color: 'var(--color-danger)', margin: 0 }}>{error || 'No statistics available'}</p>
            </ui.Card>
        );
    }

    return (
        <>
            {/* Total users card */}
            <ui.Card>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                    Total Users
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>
                    {stats.totalUsers.toLocaleString()}
                </div>
            </ui.Card>

            {/* Active users (24h) card */}
            <ui.Card>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                    Active (24h)
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>
                    {stats.activeUsers24h.toLocaleString()}
                </div>
            </ui.Card>

            {/* Total commands card */}
            <ui.Card>
                <div style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.5rem' }}>
                    Total Commands
                </div>
                <div style={{ fontSize: '1.75rem', fontWeight: 600 }}>
                    {stats.totalCommands.toLocaleString()}
                </div>
            </ui.Card>
        </>
    );
}
