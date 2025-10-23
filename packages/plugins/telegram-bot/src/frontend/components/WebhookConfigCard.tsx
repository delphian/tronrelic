import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';

/**
 * Props for WebhookConfigCard component.
 */
interface IWebhookConfigCardProps {
    context: IFrontendPluginContext;
}

/**
 * Displays webhook configuration and setup instructions.
 * Shows the webhook URL that must be configured in Telegram bot settings.
 *
 * Why this component exists:
 * Setting up a Telegram bot webhook requires copying a specific URL to Telegram's BotFather.
 * This card makes the URL easily accessible and provides setup instructions.
 */
export function WebhookConfigCard({ context }: IWebhookConfigCardProps) {
    const { ui, api } = context;
    const [webhookUrl, setWebhookUrl] = React.useState<string>('');
    const [loading, setLoading] = React.useState(true);
    const [copied, setCopied] = React.useState(false);
    const [botTokenConfigured, setBotTokenConfigured] = React.useState(true);

    /**
     * Fetches webhook URL and token configuration status from plugin configuration.
     *
     * Why fetch instead of hardcode:
     * Webhook URL depends on deployment environment (localhost, dev, prod).
     * Backend stores the correct URL based on environment variables.
     * Token status determines whether to show setup instructions.
     */
    React.useEffect(() => {
        async function fetchConfig() {
            try {
                setLoading(true);

                const response = await api.get<{ success: boolean; config: { webhookUrl: string; botTokenConfigured?: boolean } }>(
                    '/plugins/telegram-bot/config'
                );

                if (response.success && response.config.webhookUrl) {
                    setWebhookUrl(response.config.webhookUrl);
                    setBotTokenConfigured(response.config.botTokenConfigured ?? true);
                }
            } catch (err) {
                console.error('Error fetching webhook config:', err);
            } finally {
                setLoading(false);
            }
        }

        void fetchConfig();
    }, [api]);

    /**
     * Copies webhook URL to clipboard.
     *
     * Why clipboard API:
     * Manually copying long URLs is error-prone. One-click copy ensures accuracy.
     */
    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(webhookUrl);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    if (loading) {
        return (
            <ui.Card>
                <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                    Webhook Configuration
                </h2>
                <div>Loading...</div>
            </ui.Card>
        );
    }

    return (
        <ui.Card>
            <h2 style={{ fontSize: '1.125rem', fontWeight: 600, marginBottom: '1.5rem' }}>
                Webhook Configuration
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
                {/* Show setup instructions if bot token is not configured */}
                {!botTokenConfigured && (
                    <div style={{
                        padding: '1rem',
                        backgroundColor: 'rgba(255, 200, 87, 0.1)',
                        border: '1px solid var(--color-warning)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: '0.875rem'
                    }}>
                        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem', color: 'var(--color-warning)' }}>
                            ⚠️ Bot Token Not Configured
                        </h3>
                        <p style={{ marginBottom: '0.75rem', lineHeight: 1.5 }}>
                            To enable the Telegram bot, you need to obtain a bot token from BotFather and configure it in your environment.
                        </p>
                        <ol style={{ paddingLeft: '2rem', margin: 0, lineHeight: 1.8 }}>
                            <li>Open Telegram and message <code>@BotFather</code></li>
                            <li>Send <code>/newbot</code> command and follow the prompts</li>
                            <li>Copy the bot token (format: <code>123456789:ABCdefGHIjklMNOpqrsTUVwxyz</code>)</li>
                            <li>Add to your <code>.env</code> file: <code>TELEGRAM_BOT_TOKEN=your-token-here</code></li>
                            <li>Restart the backend: <code>./scripts/start.sh</code></li>
                        </ol>
                    </div>
                )}

                {/* Webhook URL - always show */}
                <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: '0.5rem' }}>
                        Webhook URL
                    </label>
                    <div style={{ display: 'flex', gap: '0.75rem' }}>
                        <ui.Input
                            type="text"
                            value={webhookUrl}
                            readOnly
                            style={{
                                flex: 1,
                                fontFamily: 'monospace',
                                fontSize: '0.875rem'
                            }}
                        />
                        <ui.Button
                            onClick={handleCopy}
                            variant="secondary"
                            size="sm"
                        >
                            {copied ? 'Copied!' : 'Copy'}
                        </ui.Button>
                    </div>
                </div>

                {/* Webhook setup instructions - show if token is configured */}
                {botTokenConfigured && (
                    <div>
                        <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: '0.75rem' }}>
                            Configure Webhook
                        </h3>
                        <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                            Use the Telegram Bot API to configure the webhook URL. Run this command in your terminal:
                        </p>
                        <pre style={{
                            padding: '0.75rem',
                            backgroundColor: 'var(--color-surface-muted)',
                            borderRadius: 'var(--radius-md)',
                            fontSize: '0.75rem',
                            overflowX: 'auto',
                            border: '1px solid var(--color-border)'
                        }}>
{`curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "${webhookUrl}",
    "secret_token": "<YOUR_WEBHOOK_SECRET>"
  }'`}
                        </pre>
                        <p style={{ fontSize: '0.75rem', color: 'var(--color-text-muted)', marginTop: '0.5rem', lineHeight: 1.5 }}>
                            Replace <code>&lt;YOUR_BOT_TOKEN&gt;</code> with your bot token and <code>&lt;YOUR_WEBHOOK_SECRET&gt;</code> with the value from <code>TELEGRAM_WEBHOOK_SECRET</code> environment variable.
                        </p>
                    </div>
                )}

                {/* Security note */}
                <div style={{
                    padding: '0.75rem',
                    backgroundColor: 'var(--color-surface-muted)',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.875rem'
                }}>
                    <strong>Security Note:</strong> This webhook is protected by IP allowlist and webhook secret.
                    Only Telegram's servers can send updates to this endpoint.
                </div>
            </div>
        </ui.Card>
    );
}
