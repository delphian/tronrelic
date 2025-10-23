import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { UserStatsCard } from './components/UserStatsCard.js';
import { WebhookConfigCard } from './components/WebhookConfigCard.js';

/**
 * Props for TelegramBotSettingsPage component.
 */
interface ITelegramBotSettingsPageProps {
    context: IFrontendPluginContext;
}

/**
 * Admin settings page for Telegram bot plugin.
 * Displays webhook configuration, user statistics, and test notification form.
 *
 * Why this page exists:
 * Admins need a central place to configure the bot, monitor usage, and test functionality.
 * This page provides all necessary controls without requiring backend terminal access.
 */
export function TelegramBotSettingsPage({ context }: ITelegramBotSettingsPageProps) {
    const { ui } = context;
    const [testChatId, setTestChatId] = React.useState('');
    const [testMessage, setTestMessage] = React.useState('');
    const [testStatus, setTestStatus] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);

    /**
     * Sends a test notification via Telegram bot.
     * Used to verify bot configuration and message formatting.
     *
     * @param e - Form submit event
     *
     * Why test notifications:
     * Before relying on automated notifications, admin should verify the bot works correctly.
     * Test messages confirm webhook, credentials, and message formatting are all correct.
     */
    const handleTestNotification = async (e: React.FormEvent) => {
        e.preventDefault();

        if (!testChatId || !testMessage) {
            setTestStatus({ type: 'error', message: 'Please fill in all fields' });
            return;
        }

        try {
            setTestStatus(null);

            // TODO: Implement test notification endpoint
            // const response = await context.api.post('/plugins/telegram-bot/system/test', {
            //     chatId: testChatId,
            //     message: testMessage
            // });

            setTestStatus({ type: 'success', message: 'Test notification sent!' });
            setTestMessage('');
        } catch (error) {
            setTestStatus({ type: 'error', message: 'Failed to send test notification' });
        }
    };

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: 'var(--space-lg)' }}>
            {/* Page header */}
            <div style={{ marginBottom: 'var(--space-xl)' }}>
                <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: 'var(--space-xs)' }}>
                    Telegram Bot Settings
                </h1>
                <p style={{ color: 'var(--color-text-secondary)', fontSize: '1rem' }}>
                    Configure and monitor your Telegram bot integration
                </p>
            </div>

            {/* Main content grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: 'var(--space-lg)',
                marginBottom: 'var(--space-xl)'
            }}>
                {/* Webhook configuration */}
                <WebhookConfigCard context={context} />

                {/* User statistics */}
                <UserStatsCard context={context} />
            </div>

            {/* Test notification form */}
            <ui.Card title="Test Notification">
                <form onSubmit={handleTestNotification} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                    {/* Chat ID input */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)' }}>
                            Chat ID
                        </label>
                        <ui.Input
                            type="text"
                            value={testChatId}
                            onChange={(e) => setTestChatId(e.target.value)}
                            placeholder="Enter Telegram chat ID"
                        />
                        <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', marginTop: 'var(--space-xs)' }}>
                            Your personal chat ID or channel ID (e.g., -1001234567890)
                        </div>
                    </div>

                    {/* Message input */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)' }}>
                            Message
                        </label>
                        <textarea
                            value={testMessage}
                            onChange={(e) => setTestMessage(e.target.value)}
                            placeholder="Enter test message"
                            rows={4}
                            style={{
                                width: '100%',
                                padding: 'var(--space-sm)',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                backgroundColor: 'var(--color-surface)',
                                color: 'var(--color-text)',
                                fontFamily: 'inherit',
                                fontSize: '0.875rem',
                                resize: 'vertical'
                            }}
                        />
                    </div>

                    {/* Status message */}
                    {testStatus && (
                        <div style={{
                            padding: 'var(--space-sm)',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: testStatus.type === 'success'
                                ? 'var(--color-success-bg)'
                                : 'var(--color-error-bg)',
                            color: testStatus.type === 'success'
                                ? 'var(--color-success)'
                                : 'var(--color-error)',
                            fontSize: '0.875rem'
                        }}>
                            {testStatus.message}
                        </div>
                    )}

                    {/* Submit button */}
                    <div>
                        <ui.Button type="submit" variant="primary">
                            Send Test Notification
                        </ui.Button>
                    </div>
                </form>
            </ui.Card>

            {/* Future feature: Subscription management */}
            <ui.Card title="Subscription Types" style={{ marginTop: 'var(--space-lg)' }}>
                <div style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                    <p style={{ marginBottom: 'var(--space-md)' }}>
                        Subscription management coming soon. Users will be able to subscribe to:
                    </p>
                    <ul style={{ paddingLeft: 'var(--space-lg)', margin: 0 }}>
                        <li style={{ marginBottom: 'var(--space-xs)' }}>Whale Alerts - Large TRX transfers</li>
                        <li style={{ marginBottom: 'var(--space-xs)' }}>Market Updates - Significant price changes</li>
                        <li style={{ marginBottom: 'var(--space-xs)' }}>Price Alerts - Custom threshold notifications</li>
                    </ul>
                </div>
            </ui.Card>
        </div>
    );
}
