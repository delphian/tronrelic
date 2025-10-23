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

    /**
     * Fetches webhook URL from plugin configuration.
     *
     * Why fetch instead of hardcode:
     * Webhook URL depends on deployment environment (localhost, dev, prod).
     * Backend stores the correct URL based on environment variables.
     */
    React.useEffect(() => {
        async function fetchConfig() {
            try {
                setLoading(true);

                const response = await api.get<{ success: boolean; config: { webhookUrl: string } }>(
                    '/plugins/telegram-bot/config'
                );

                if (response.success && response.config.webhookUrl) {
                    setWebhookUrl(response.config.webhookUrl);
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
            <ui.Card title="Webhook Configuration">
                <ui.Skeleton count={3} />
            </ui.Card>
        );
    }

    return (
        <ui.Card title="Webhook Configuration">
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)' }}>
                {/* Webhook URL */}
                <div>
                    <label style={{ display: 'block', fontSize: '0.875rem', fontWeight: 500, marginBottom: 'var(--space-xs)' }}>
                        Webhook URL
                    </label>
                    <div style={{ display: 'flex', gap: 'var(--space-sm)' }}>
                        <ui.Input
                            value={webhookUrl}
                            readOnly
                            style={{ flex: 1 }}
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

                {/* Setup instructions */}
                <div>
                    <h3 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 'var(--space-sm)' }}>
                        Setup Instructions
                    </h3>
                    <ol style={{ paddingLeft: 'var(--space-lg)', margin: 0, color: 'var(--color-text-secondary)' }}>
                        <li style={{ marginBottom: 'var(--space-xs)' }}>
                            Open Telegram and message <code>@BotFather</code>
                        </li>
                        <li style={{ marginBottom: 'var(--space-xs)' }}>
                            Send <code>/setwebhook</code> command
                        </li>
                        <li style={{ marginBottom: 'var(--space-xs)' }}>
                            Select your bot from the list
                        </li>
                        <li style={{ marginBottom: 'var(--space-xs)' }}>
                            Paste the webhook URL above
                        </li>
                        <li>
                            BotFather will confirm the webhook is set
                        </li>
                    </ol>
                </div>

                {/* Security note */}
                <div style={{
                    padding: 'var(--space-sm)',
                    backgroundColor: 'var(--color-surface-secondary)',
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
