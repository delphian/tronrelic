import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import type { ITelegramChannel } from '../shared/index.js';
import { BotSettingsCard } from './components/BotSettingsCard';
import { UserStatsCard } from './components/UserStatsCard';
import { WebhookConfigCard } from './components/WebhookConfigCard';
import { SettingsCard } from './components/SettingsCard';

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
    const [selectedChannelId, setSelectedChannelId] = React.useState('');
    const [testThreadId, setTestThreadId] = React.useState('');
    const [testMessage, setTestMessage] = React.useState('');
    const [testStatus, setTestStatus] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [isSending, setIsSending] = React.useState(false);
    const [botTokenConfigured, setBotTokenConfigured] = React.useState<boolean | undefined>(undefined);
    const [webhookSecretConfigured, setWebhookSecretConfigured] = React.useState<boolean | undefined>(undefined);
    const [channels, setChannels] = React.useState<ITelegramChannel[]>([]);
    const [isLoadingChannels, setIsLoadingChannels] = React.useState(false);

    /**
     * Fetches the list of channels the bot is a member of.
     * Loads channels on component mount.
     *
     * Why fetch channels:
     * Provides a convenient dropdown for admins to select destination channels
     * without having to manually look up and enter chat IDs.
     */
    React.useEffect(() => {
        async function fetchChannels() {
            try {
                setIsLoadingChannels(true);
                const response = await context.api.get<{ success: boolean; channels: ITelegramChannel[] }>(
                    '/plugins/telegram-bot/system/channels'
                );

                if (response.success && response.channels) {
                    setChannels(response.channels);
                }
            } catch (error: any) {
                console.error('Failed to fetch channels:', error);
            } finally {
                setIsLoadingChannels(false);
            }
        }

        void fetchChannels();
    }, [context.api]);

    /**
     * Handles channel selection from the dropdown.
     * Auto-populates the chat ID field when a channel is selected.
     *
     * @param e - Select change event
     *
     * Why auto-populate chat ID:
     * Saves admins from having to manually copy/paste chat IDs.
     * Either the dropdown OR manual chat ID entry can be used.
     */
    const handleChannelSelect = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const channelId = e.target.value;
        setSelectedChannelId(channelId);

        if (channelId) {
            // Auto-populate chat ID when a channel is selected
            setTestChatId(channelId);
        }
    };

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

        // Use either manually entered chat ID or selected channel
        const chatId = testChatId;

        if (!chatId || !testMessage) {
            setTestStatus({ type: 'error', message: 'Chat ID and message are required' });
            return;
        }

        try {
            setIsSending(true);
            setTestStatus(null);

            const response = await context.api.post<{ success: boolean; message?: string; error?: string }>(
                '/plugins/telegram-bot/system/test',
                {
                    chatId: chatId,
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
        <div>
            {/* Page header */}
            <div style={{ marginBottom: '3rem' }}>
                <h1 style={{ fontSize: '1.875rem', fontWeight: 700, marginBottom: '0.5rem' }}>
                    Telegram Bot Settings
                </h1>
                <p style={{ color: 'var(--color-text-muted)', fontSize: '1rem' }}>
                    Configure and monitor your Telegram bot integration
                </p>
            </div>

            {/* User statistics - Top row with individual stat cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
                gap: '1.5rem',
                marginBottom: '3rem'
            }}>
                <UserStatsCard context={context} />
            </div>

            {/* Main content grid */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                gap: '2rem',
                marginBottom: '3rem'
            }}>
                {/* Bot settings */}
                <BotSettingsCard
                    context={context}
                    onSettingsSaved={(settings) => {
                        if (settings.botTokenConfigured !== undefined) {
                            setBotTokenConfigured(settings.botTokenConfigured);
                        }
                        if (settings.webhookSecretConfigured !== undefined) {
                            setWebhookSecretConfigured(settings.webhookSecretConfigured);
                        }
                    }}
                />

                {/* Webhook configuration */}
                <WebhookConfigCard
                    context={context}
                    botTokenConfigured={botTokenConfigured}
                    webhookSecretConfigured={webhookSecretConfigured}
                    onWebhookSecretConfiguredChange={setWebhookSecretConfigured}
                />
            </div>

            {/* Settings card - full width */}
            <div style={{ marginBottom: '3rem' }}>
                <SettingsCard context={context} />
            </div>

            {/* Test notification form */}
            <ui.Card style={{ marginBottom: '3rem' }}>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Test Notification
                </h3>
                <form onSubmit={handleTestNotification} style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                    {/* Chat ID and Channel Select - side by side */}
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
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
                                Enter manually or select from dropdown
                            </div>
                        </div>

                        {/* Channel Select dropdown */}
                        <div>
                            <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                                Or Select Channel/Group
                            </label>
                            <select
                                value={selectedChannelId}
                                onChange={handleChannelSelect}
                                disabled={isSending || isLoadingChannels}
                                style={{
                                    width: '100%',
                                    padding: '0.5rem 0.75rem',
                                    borderRadius: 'var(--radius-md)',
                                    border: '1px solid var(--color-border)',
                                    backgroundColor: (isSending || isLoadingChannels) ? 'var(--color-surface-secondary)' : 'var(--color-surface)',
                                    color: 'var(--color-text)',
                                    fontFamily: 'inherit',
                                    fontSize: '0.875rem',
                                    opacity: (isSending || isLoadingChannels) ? 0.6 : 1,
                                    cursor: (isSending || isLoadingChannels) ? 'not-allowed' : 'pointer'
                                }}
                            >
                                <option value="">
                                    {isLoadingChannels ? 'Loading channels...' : '-- Select a channel --'}
                                </option>
                                {channels
                                    .filter(channel => channel.isActive)
                                    .map((channel) => (
                                        <option key={channel.chatId} value={channel.chatId}>
                                            {channel.title || `Chat ${channel.chatId}`} ({channel.type})
                                        </option>
                                    ))
                                }
                            </select>
                            <div style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem' }}>
                                {channels.filter(c => c.isActive).length > 0
                                    ? `${channels.filter(c => c.isActive).length} active channel${channels.filter(c => c.isActive).length !== 1 ? 's' : ''}`
                                    : 'No channels found'
                                }
                            </div>
                        </div>
                    </div>

                    {/* Thread ID input - full width */}
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
