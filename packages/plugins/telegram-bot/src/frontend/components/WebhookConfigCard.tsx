import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { Copy, Check } from 'lucide-react';

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
    const [configuring, setConfiguring] = React.useState(false);
    const [configureResult, setConfigureResult] = React.useState<{ success: boolean; message: string } | null>(null);
    const [verifying, setVerifying] = React.useState(false);
    const [verifyResult, setVerifyResult] = React.useState<{ success: boolean; message: string; details?: any } | null>(null);

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

    /**
     * Configures the Telegram webhook automatically via backend API.
     *
     * Why automatic configuration:
     * Instead of requiring users to manually run curl commands with their bot token,
     * this sends a request to the backend which securely uses the stored token.
     * Eliminates manual errors and exposes no credentials in the frontend.
     */
    const handleConfigureWebhook = async () => {
        try {
            setConfiguring(true);
            setConfigureResult(null);

            const response = await api.post<{ success: boolean; message: string; error?: string }>(
                '/plugins/telegram-bot/system/configure-webhook',
                {}
            );

            if (response.success) {
                setConfigureResult({ success: true, message: response.message || 'Webhook configured successfully!' });
            } else {
                setConfigureResult({ success: false, message: response.error || 'Failed to configure webhook' });
            }
        } catch (err: any) {
            console.error('Error configuring webhook:', err);
            setConfigureResult({
                success: false,
                message: err.response?.data?.error || err.message || 'Failed to configure webhook'
            });
        } finally {
            setConfiguring(false);

            // Clear result message after 5 seconds
            setTimeout(() => setConfigureResult(null), 5000);
        }
    };

    /**
     * Verifies the webhook configuration with Telegram's getWebhookInfo API.
     *
     * Why verification matters:
     * After configuring the webhook, administrators need confirmation that Telegram
     * accepted the configuration and is using the correct URL. This endpoint queries
     * Telegram's API to check the current webhook status and validates it matches
     * the expected configuration.
     */
    const handleVerifyWebhook = async () => {
        try {
            setVerifying(true);
            setVerifyResult(null);

            const response = await api.get<{
                success: boolean;
                isConfigured: boolean;
                expectedUrl: string;
                webhookInfo: {
                    url: string;
                    hasCustomCertificate: boolean;
                    pendingUpdateCount: number;
                    lastErrorDate?: number;
                    lastErrorMessage?: string;
                    maxConnections: number;
                    ipAddress?: string;
                };
                error?: string;
            }>('/plugins/telegram-bot/system/verify-webhook');

            if (response.success) {
                if (response.isConfigured) {
                    setVerifyResult({
                        success: true,
                        message: '✓ Webhook is correctly configured!',
                        details: response.webhookInfo
                    });
                } else {
                    setVerifyResult({
                        success: false,
                        message: response.webhookInfo.url
                            ? `✗ Webhook URL mismatch. Expected: ${response.expectedUrl}, Got: ${response.webhookInfo.url}`
                            : '✗ Webhook is not configured in Telegram. Click "Configure Webhook" to set it up.',
                        details: response.webhookInfo
                    });
                }
            } else {
                setVerifyResult({
                    success: false,
                    message: response.error || 'Failed to verify webhook'
                });
            }
        } catch (err: any) {
            console.error('Error verifying webhook:', err);
            setVerifyResult({
                success: false,
                message: err.response?.data?.error || err.message || 'Failed to verify webhook'
            });
        } finally {
            setVerifying(false);

            // Clear result message after 10 seconds (longer for verification details)
            setTimeout(() => setVerifyResult(null), 10000);
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
                        <input
                            type="text"
                            value={webhookUrl}
                            readOnly
                            style={{
                                flex: 1,
                                fontFamily: 'monospace',
                                fontSize: '0.875rem',
                                padding: '0.5rem 0.75rem',
                                border: '1px solid var(--color-border)',
                                borderRadius: 'var(--radius-md)',
                                backgroundColor: 'var(--color-surface-muted)',
                                color: 'var(--color-text)',
                                cursor: 'text'
                            }}
                        />
                        <ui.Button
                            onClick={handleCopy}
                            variant="secondary"
                            size="sm"
                            aria-label={copied ? 'Copied to clipboard' : 'Copy to clipboard'}
                        >
                            {copied ? <Check size={16} /> : <Copy size={16} />}
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
                            Click the button below to automatically configure the webhook with Telegram:
                        </p>
                        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                            <ui.Button
                                onClick={handleConfigureWebhook}
                                variant="secondary"
                                size="md"
                                disabled={configuring}
                            >
                                {configuring ? 'Configuring...' : 'Configure Webhook'}
                            </ui.Button>
                            <ui.Button
                                onClick={handleVerifyWebhook}
                                variant="secondary"
                                size="md"
                                disabled={verifying}
                            >
                                {verifying ? 'Verifying...' : 'Verify Webhook'}
                            </ui.Button>
                        </div>

                        {/* Show configure result message */}
                        {configureResult && (
                            <div style={{
                                marginTop: '0.75rem',
                                padding: '0.75rem',
                                backgroundColor: configureResult.success
                                    ? 'rgba(34, 197, 94, 0.1)'
                                    : 'rgba(239, 68, 68, 0.1)',
                                border: `1px solid ${configureResult.success ? 'var(--color-success)' : 'var(--color-error)'}`,
                                borderRadius: 'var(--radius-md)',
                                fontSize: '0.875rem',
                                color: configureResult.success ? 'var(--color-success)' : 'var(--color-error)'
                            }}>
                                {configureResult.success ? '✓ ' : '✗ '}
                                {configureResult.message}
                            </div>
                        )}

                        {/* Show verify result message with details */}
                        {verifyResult && (
                            <div style={{
                                marginTop: '0.75rem',
                                padding: '0.75rem',
                                backgroundColor: verifyResult.success
                                    ? 'rgba(34, 197, 94, 0.1)'
                                    : 'rgba(239, 68, 68, 0.1)',
                                border: `1px solid ${verifyResult.success ? 'var(--color-success)' : 'var(--color-error)'}`,
                                borderRadius: 'var(--radius-md)',
                                fontSize: '0.875rem',
                                color: verifyResult.success ? 'var(--color-success)' : 'var(--color-error)'
                            }}>
                                <div>{verifyResult.message}</div>
                                {verifyResult.details && (
                                    <details style={{ marginTop: '0.5rem' }}>
                                        <summary style={{
                                            cursor: 'pointer',
                                            fontSize: '0.75rem',
                                            opacity: 0.8,
                                            userSelect: 'none'
                                        }}>
                                            View Details
                                        </summary>
                                        <div style={{
                                            marginTop: '0.5rem',
                                            fontSize: '0.75rem',
                                            fontFamily: 'monospace',
                                            opacity: 0.9
                                        }}>
                                            {verifyResult.details.url && (
                                                <div>URL: {verifyResult.details.url}</div>
                                            )}
                                            {verifyResult.details.pendingUpdateCount !== undefined && (
                                                <div>Pending Updates: {verifyResult.details.pendingUpdateCount}</div>
                                            )}
                                            {verifyResult.details.maxConnections && (
                                                <div>Max Connections: {verifyResult.details.maxConnections}</div>
                                            )}
                                            {verifyResult.details.ipAddress && (
                                                <div>IP Address: {verifyResult.details.ipAddress}</div>
                                            )}
                                            {verifyResult.details.lastErrorMessage && (
                                                <div style={{ color: 'var(--color-error)' }}>
                                                    Last Error: {verifyResult.details.lastErrorMessage}
                                                </div>
                                            )}
                                        </div>
                                    </details>
                                )}
                            </div>
                        )}

                        <details style={{ marginTop: '1rem' }}>
                            <summary style={{
                                fontSize: '0.875rem',
                                fontWeight: 500,
                                cursor: 'pointer',
                                color: 'var(--color-text-muted)',
                                userSelect: 'none'
                            }}>
                                Advanced: Manual Configuration
                            </summary>
                            <div style={{ marginTop: '0.75rem' }}>
                                <p style={{ fontSize: '0.875rem', color: 'var(--color-text-muted)', marginBottom: '0.75rem', lineHeight: 1.5 }}>
                                    Alternatively, run this command in your terminal:
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
                        </details>
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
