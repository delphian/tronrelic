import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { UserStatsCard } from './components/UserStatsCard';
import { WebhookConfigCard } from './components/WebhookConfigCard';

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
    const [testThreadId, setTestThreadId] = React.useState('');
    const [testMessage, setTestMessage] = React.useState('');
    const [testStatus, setTestStatus] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [isSending, setIsSending] = React.useState(false);

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
            setTestStatus({ type: 'error', message: 'Chat ID and message are required' });
            return;
        }

        try {
            setIsSending(true);
            setTestStatus(null);

            const response = await context.api.post<{ success: boolean; message?: string; error?: string }>(
                '/plugins/telegram-bot/system/test',
                {
                    chatId: testChatId,
                    message: testMessage,
                    threadId: testThreadId || undefined
                }
            );

            if (response.success) {
                setTestStatus({ type: 'success', message: response.message || 'Test notification sent successfully!' });
                setTestMessage('');
            } else {
                setTestStatus({ type: 'error', message: response.error || 'Failed to send test notification' });
            }
        } catch (error: any) {
            const errorMessage = error.response?.data?.error || error.message || 'Failed to send test notification';
            setTestStatus({ type: 'error', message: errorMessage });
        } finally {
            setIsSending(false);
        }
    };

    return (
        <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '2rem' }}>
            {/* Page header */}
            <div style={{ marginBottom: '3rem' }}>
                <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                    Telegram Bot Settings
                </h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '1rem' }}>
                    Configure and monitor your Telegram bot integration
                </p>
            </div>

            {/* Main content grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '2rem',
                marginBottom: '3rem'
            }}>
                {/* Webhook configuration */}
                <WebhookConfigCard context={context} />

                {/* User statistics */}
                <UserStatsCard context={context} />
            </div>

            {/* Test notification form */}
            <ui.Card style={{ marginBottom: '3rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Test Notification
                </h3>
                <form onSubmit={handleTestNotification} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* Chat ID and Thread ID - side by side */}
                    <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1rem' }}>
                        {/* Chat ID input */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                                Chat ID <span style={{ color: 'var(--color-danger)' }}>*</span>
                            </label>
                            <ui.Input
                                type="text"
                                value={testChatId}
                                onChange={(e) => setTestChatId(e.target.value)}
                                placeholder="-1001234567890"
                                disabled={isSending}
                            />
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                                Your personal chat ID or channel ID (e.g., -1001234567890)
                            </div>
                        </div>

                        {/* Thread ID input */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                                Thread ID (Optional)
                            </label>
                            <ui.Input
                                type="text"
                                value={testThreadId}
                                onChange={(e) => setTestThreadId(e.target.value)}
                                placeholder="51"
                                disabled={isSending}
                            />
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                                Leave empty to post to main channel, or enter a topic/thread ID for organized channels
                            </div>
                        </div>
                    </div>

                    {/* Message input */}
                    <div>
                        <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                            Message <span style={{ color: 'var(--color-danger)' }}>*</span>
                        </label>
                        <textarea
                            value={testMessage}
                            onChange={(e) => setTestMessage(e.target.value)}
                            placeholder="Enter test message"
                            rows={4}
                            disabled={isSending}
                            style={{
                                width: '100%',
                                padding: '0.75rem',
                                borderRadius: 'var(--radius-md)',
                                border: '1px solid var(--color-border)',
                                backgroundColor: isSending ? 'var(--color-surface-secondary)' : 'var(--color-surface)',
                                color: 'var(--color-text)',
                                fontFamily: 'inherit',
                                fontSize: '0.875rem',
                                resize: 'vertical',
                                opacity: isSending ? 0.6 : 1
                            }}
                        />
                    </div>

                    {/* Status message */}
                    {testStatus && (
                        <div style={{
                            padding: '0.75rem',
                            borderRadius: 'var(--radius-md)',
                            backgroundColor: testStatus.type === 'success'
                                ? 'rgba(87, 212, 140, 0.1)'
                                : 'rgba(255, 111, 125, 0.1)',
                            border: testStatus.type === 'success'
                                ? '1px solid var(--color-success)'
                                : '1px solid var(--color-danger)',
                            color: testStatus.type === 'success'
                                ? 'var(--color-success)'
                                : 'var(--color-danger)',
                            fontSize: '0.875rem',
                            lineHeight: 1.5
                        }}>
                            {testStatus.message}
                        </div>
                    )}

                    {/* Submit button */}
                    <div>
                        <ui.Button type="submit" variant="primary" disabled={isSending}>
                            {isSending ? 'Sending...' : 'Send Test Notification'}
                        </ui.Button>
                    </div>
                </form>
            </ui.Card>

            {/* Future feature: Subscription management */}
            <ui.Card>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Subscription Types
                </h3>
                <div style={{ color: 'var(--color-text-muted)', fontSize: '0.875rem' }}>
                    <p style={{ marginBottom: '1rem' }}>
                        Subscription management coming soon. Users will be able to subscribe to:
                    </p>
                    <ul style={{ paddingLeft: '2rem', margin: 0 }}>
                        <li style={{ marginBottom: '0.5rem' }}>Whale Alerts - Large TRX transfers</li>
                        <li style={{ marginBottom: '0.5rem' }}>Market Updates - Significant price changes</li>
                        <li style={{ marginBottom: '0.5rem' }}>Price Alerts - Custom threshold notifications</li>
                    </ul>
                </div>
            </ui.Card>
        </div>
    );
}
