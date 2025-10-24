import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { Copy, Check, AlertCircle, X } from 'lucide-react';
import styles from './WebhookConfigCard.module.css';

/**
 * Props for WebhookConfigCard component.
 */
interface IWebhookConfigCardProps {
    context: IFrontendPluginContext;
    webhookSecretConfigured?: boolean;
    onWebhookSecretConfiguredChange?: (configured: boolean) => void;
}

/**
 * Displays webhook configuration and setup instructions.
 * Shows the webhook URL that must be configured in Telegram bot settings.
 *
 * Why this component exists:
 * Setting up a Telegram bot webhook requires copying a specific URL to Telegram's BotFather.
 * This card makes the URL easily accessible and provides setup instructions.
 */
export function WebhookConfigCard({ context, webhookSecretConfigured: externalWebhookSecretConfigured, onWebhookSecretConfiguredChange }: IWebhookConfigCardProps) {
    const { ui, api } = context;
    const [webhookUrl, setWebhookUrl] = React.useState<string>('');
    const [loading, setLoading] = React.useState(true);
    const [copied, setCopied] = React.useState(false);
    const [botTokenConfigured, setBotTokenConfigured] = React.useState(true);
    const [internalWebhookSecretConfigured, setInternalWebhookSecretConfigured] = React.useState(true);
    const [configuring, setConfiguring] = React.useState(false);
    const [configureResult, setConfigureResult] = React.useState<{ success: boolean; message: string } | null>(null);
    const [verifying, setVerifying] = React.useState(false);
    const [verifyResult, setVerifyResult] = React.useState<{ success: boolean; message: string; details?: any } | null>(null);

    // Use external prop if provided, otherwise use internal state
    const webhookSecretConfigured = externalWebhookSecretConfigured ?? internalWebhookSecretConfigured;

    /**
     * Fetches webhook URL and configuration status from both config and settings endpoints.
     *
     * Why fetch instead of hardcode:
     * Webhook URL depends on deployment environment (localhost, dev, prod).
     * Backend stores the correct URL based on environment variables.
     * Token and secret status determine whether to show setup instructions and enable webhook deployment.
     */
    React.useEffect(() => {
        async function fetchConfig() {
            try {
                setLoading(true);

                // Fetch webhook URL from config endpoint
                const configResponse = await api.get<{ success: boolean; config: { webhookUrl: string; botTokenConfigured?: boolean } }>(
                    '/plugins/telegram-bot/config'
                );

                if (configResponse.success && configResponse.config.webhookUrl) {
                    setWebhookUrl(configResponse.config.webhookUrl);
                    setBotTokenConfigured(configResponse.config.botTokenConfigured ?? true);
                }

                // Fetch webhook secret configuration status from settings endpoint (only if not provided by parent)
                if (externalWebhookSecretConfigured === undefined) {
                    const settingsResponse = await api.get<{ success: boolean; settings: { webhookSecretConfigured: boolean } }>(
                        '/plugins/telegram-bot/system/settings'
                    );

                    if (settingsResponse.success) {
                        const configured = settingsResponse.settings.webhookSecretConfigured ?? false;
                        setInternalWebhookSecretConfigured(configured);
                        if (onWebhookSecretConfiguredChange) {
                            onWebhookSecretConfiguredChange(configured);
                        }
                    }
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
                            : '✗ Webhook is not configured in Telegram. Click "Register Webhook" to set it up.',
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
        }
    };

    if (loading) {
        return (
            <ui.Card>
                <h2 className={styles.card_title}>
                    Webhook Configuration
                </h2>
                <div className={styles.loading}>Loading...</div>
            </ui.Card>
        );
    }

    return (
        <ui.Card>
            <h2 className={styles.card_title}>
                Webhook Configuration
            </h2>
            <div className={styles.content}>
                {/* Show setup instructions if bot token is not configured */}
                {!botTokenConfigured && (
                    <div className={styles.warning_card}>
                        <h3 className={styles.warning_title}>
                            <AlertCircle size={16} />
                            Bot Token Not Configured
                        </h3>
                        <p className={styles.warning_text}>
                            To enable the Telegram bot, you need to obtain a bot token from BotFather and configure it via the admin interface.
                        </p>
                        <ol className={styles.warning_list}>
                            <li>Open Telegram and message <code>@BotFather</code></li>
                            <li>Send <code>/newbot</code> command and follow the prompts</li>
                            <li>Copy the bot token (format: <code>123456789:ABCdefGHIjklMNOpqrsTUVwxyz</code>)</li>
                            <li>Navigate to the "Bot Authorization" card below</li>
                            <li>Paste the token and click "Save Settings"</li>
                        </ol>
                    </div>
                )}

                {/* Webhook URL - always show */}
                <div className={styles.field}>
                    <label className={styles.label}>
                        Webhook URL
                    </label>
                    <div className={styles.url_input_group}>
                        <input
                            type="text"
                            value={webhookUrl}
                            readOnly
                            className={styles.url_input}
                            aria-label="Webhook URL"
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
                    <div className={styles.config_section}>
                        <h3 className={styles.section_title}>
                            Register Webhook with Telegram
                        </h3>

                        {/* Warning if webhook secret is not configured - moved here */}
                        {!webhookSecretConfigured && (
                            <div className={styles.warning_card} style={{ marginBottom: '1rem' }}>
                                <h3 className={styles.warning_title}>
                                    <AlertCircle size={16} />
                                    Webhook Secret Not Configured
                                </h3>
                                <p className={styles.warning_text}>
                                    You must configure a webhook secret before registering the webhook. The secret ensures that
                                    incoming webhook requests are actually from Telegram's servers.
                                </p>
                                <p className={styles.warning_text}>
                                    See the "Bot Authorization" card above and generate/save a webhook secret, then return here to register the webhook.
                                </p>
                            </div>
                        )}

                        <div className={styles.button_row}>
                            <ui.Button
                                onClick={handleConfigureWebhook}
                                variant="secondary"
                                size="md"
                                disabled={configuring || !webhookSecretConfigured}
                            >
                                {configuring ? 'Registering...' : 'Register Webhook'}
                            </ui.Button>
                            <ui.Button
                                onClick={handleVerifyWebhook}
                                variant="secondary"
                                size="md"
                                disabled={verifying}
                            >
                                {verifying ? 'Verifying...' : 'Verify'}
                            </ui.Button>
                        </div>

                        {/* Show configure result message */}
                        {configureResult && (
                            <div className={`${styles.feedback_message} ${configureResult.success ? (styles as any)['feedback_message--success'] : (styles as any)['feedback_message--error']}`}>
                                <span className={styles.feedback_text}>
                                    {configureResult.success ? '✓ ' : '✗ '}
                                    {configureResult.message}
                                </span>
                            </div>
                        )}

                        {/* Show verify result message with details */}
                        {verifyResult && (
                            <div className={`${styles.feedback_message} ${verifyResult.success ? (styles as any)['feedback_message--success'] : (styles as any)['feedback_message--error']}`}>
                                <span className={styles.feedback_text}>{verifyResult.message}</span>
                                <button
                                    type="button"
                                    onClick={() => setVerifyResult(null)}
                                    className={styles.close_button}
                                    aria-label="Close message"
                                >
                                    <X size={16} />
                                </button>
                                {verifyResult.details && (
                                    <details className={styles.feedback_details}>
                                        <summary className={styles.details_summary}>
                                            View Details
                                        </summary>
                                        <div className={styles.details_content}>
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
                                                <div className={styles.error_text}>
                                                    Last Error: {verifyResult.details.lastErrorMessage}
                                                </div>
                                            )}
                                        </div>
                                    </details>
                                )}
                            </div>
                        )}

                        <details className={styles.advanced_instructions}>
                            <summary className={styles.instructions_summary}>
                                Advanced: Manual Registration
                            </summary>
                            <div className={styles.instructions_content}>
                                <p className={styles.instructions_text}>
                                    Alternatively, run this command in your terminal:
                                </p>
                                <pre className={styles.code_block}>
{`curl -X POST "https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook" \\
  -H "Content-Type: application/json" \\
  -d '{
    "url": "${webhookUrl}",
    "secret_token": "<YOUR_WEBHOOK_SECRET>"
  }'`}
                                </pre>
                                <p className={styles.code_note}>
                                    Replace <code>&lt;YOUR_BOT_TOKEN&gt;</code> with your bot token and <code>&lt;YOUR_WEBHOOK_SECRET&gt;</code> with the webhook secret configured in the settings above.
                                </p>
                            </div>
                        </details>
                    </div>
                )}

                {/* Security note */}
                <div className={styles.security_note}>
                    <strong>Security Note:</strong> This webhook is protected by IP allowlist and webhook secret.
                    Only Telegram's servers can send updates to this endpoint.
                </div>
            </div>
        </ui.Card>
    );
}
