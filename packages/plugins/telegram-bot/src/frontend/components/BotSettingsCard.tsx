import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { Settings, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import styles from './BotSettingsCard.module.css';

/**
 * Props for BotSettingsCard component.
 */
interface IBotSettingsCardProps {
    context: IFrontendPluginContext;
    onSettingsSaved?: (settings: ISettingsResponse) => void;
}

/**
 * Response from GET /plugins/telegram-bot/system/settings endpoint.
 * Contains current bot configuration including masked token, webhook secret, and rate limit settings.
 */
interface ISettingsResponse {
    botToken: string;
    botTokenConfigured: boolean;
    webhookSecret: string;
    webhookSecretConfigured: boolean;
    rateLimitPerUser: number;
    rateLimitWindowMs: number;
}

/**
 * Bot Authorization Card Component
 *
 * Provides configuration interface for the Telegram bot token and webhook secret.
 * Allows administrators to view, edit, and update authorization credentials without
 * requiring backend server restarts or direct environment variable access.
 *
 * Why this component exists:
 * Administrators need a way to configure bot authorization credentials through the UI
 * instead of editing environment files and restarting services. This card provides a
 * secure interface for credential management with proper masking, validation, and feedback.
 *
 * @param props - Component properties
 * @param props.context - Plugin context providing API client and UI components
 */
export function BotSettingsCard({ context, onSettingsSaved }: IBotSettingsCardProps) {
    const { ui, layout, api } = context;

    // State management
    const [loading, setLoading] = React.useState(true);
    const [showToken, setShowToken] = React.useState(false);
    const [showSecret, setShowSecret] = React.useState(false);
    const [settings, setSettings] = React.useState<ISettingsResponse | null>(null);
    const [tokenInput, setTokenInput] = React.useState('');
    const [secretInput, setSecretInput] = React.useState('');
    const [isSaving, setIsSaving] = React.useState(false);
    const [feedback, setFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);

    /**
     * Fetches current bot settings from backend.
     *
     * Why fetch instead of hardcode:
     * Token configuration is stored in environment variables and database.
     * The backend provides a secure API endpoint that returns the masked token
     * and configuration status without exposing the full token unnecessarily.
     */
    React.useEffect(() => {
        async function fetchSettings() {
            try {
                setLoading(true);
                const response = await api.get<{ success: boolean; settings: ISettingsResponse }>('/plugins/telegram-bot/system/settings');
                setSettings(response.settings);
            } catch (err) {
                console.error('Error fetching bot settings:', err);
                setFeedback({
                    type: 'error',
                    message: 'Failed to load settings. Please refresh the page.'
                });
            } finally {
                setLoading(false);
            }
        }

        void fetchSettings();
    }, [api]);

    /**
     * Validates bot token format before submission.
     *
     * Why validation matters:
     * Telegram bot tokens have a specific format: <bot-id>:<random-token>.
     * Validating the format before sending to backend prevents invalid API calls
     * and provides immediate user feedback for common mistakes.
     *
     * @param token - Token string to validate
     * @returns True if token format is valid
     */
    const validateTokenFormat = (token: string): boolean => {
        // Telegram bot token format: <bot-id>:<random-token>
        // Example: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz
        const tokenRegex = /^\d+:[A-Za-z0-9_-]{35}$/;
        return tokenRegex.test(token);
    };


    /**
     * Generates a secure random webhook secret (32-character hex string).
     *
     * Why generate on client:
     * Generating the secret client-side prevents it from being transmitted to the
     * backend before the user explicitly saves it. This reduces attack surface.
     *
     * Why toggle visibility:
     * After generating a new secret, we want to show it to the user so they can
     * see what was generated. This provides immediate visual feedback and allows
     * the user to verify the generated secret before saving.
     */
    const handleGenerateSecret = () => {
        // Generate 16 random bytes and convert to hex (32 characters)
        const array = new Uint8Array(16);
        crypto.getRandomValues(array);
        const hexString = Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
        setSecretInput(hexString);
        setShowSecret(true); // Show the newly generated secret
    };

    /**
     * Saves the bot token and/or webhook secret to the backend.
     *
     * Why async API call:
     * The backend stores these values securely and validates formats before saving.
     * After a successful save, the webhook configuration can be updated with the
     * new secret.
     */
    const handleSaveClick = async () => {
        // Validate inputs if provided
        if (tokenInput && !validateTokenFormat(tokenInput)) {
            setFeedback({
                type: 'error',
                message: 'Invalid token format. Expected format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            });
            return;
        }

        if (secretInput && secretInput.length < 16) {
            setFeedback({
                type: 'error',
                message: 'Webhook secret must be at least 16 characters long'
            });
            return;
        }

        // Must provide at least one value
        if (!tokenInput && !secretInput) {
            setFeedback({
                type: 'error',
                message: 'Please provide at least one value to save'
            });
            return;
        }

        try {
            setIsSaving(true);
            setFeedback(null);

            // Build update object with only provided fields
            const updates: { botToken?: string; webhookSecret?: string } = {};
            if (tokenInput) updates.botToken = tokenInput;
            if (secretInput) updates.webhookSecret = secretInput;

            await api.put('/plugins/telegram-bot/system/settings', updates);

            // Refresh settings to get the new masked values
            const response = await api.get<{ success: boolean; settings: ISettingsResponse }>('/plugins/telegram-bot/system/settings');
            setSettings(response.settings);

            // Notify parent component of settings update
            if (onSettingsSaved) {
                onSettingsSaved(response.settings);
            }

            setFeedback({
                type: 'success',
                message: 'Settings updated successfully!'
            });

            setTokenInput('');
            setSecretInput('');
            setShowToken(false);
            setShowSecret(false);

            // Clear success message after 5 seconds
            setTimeout(() => setFeedback(null), 5000);
        } catch (err: any) {
            console.error('Error saving settings:', err);
            setFeedback({
                type: 'error',
                message: err.response?.data?.error || err.message || 'Failed to save settings'
            });
        } finally {
            setIsSaving(false);
        }
    };

    /**
     * Toggles token visibility between masked and revealed states.
     *
     * Why toggle instead of always showing:
     * Bot tokens are sensitive credentials. Keeping them masked by default
     * prevents shoulder surfing and accidental exposure in screenshots or
     * screen shares. Only reveal when explicitly requested.
     */
    const handleToggleTokenVisibility = () => {
        setShowToken(!showToken);
    };

    /**
     * Toggles webhook secret visibility between masked and revealed states.
     *
     * Why toggle instead of always showing:
     * Webhook secrets are sensitive credentials. Keeping them masked by default
     * prevents shoulder surfing and accidental exposure. Only reveal when
     * explicitly requested.
     */
    const handleToggleSecretVisibility = () => {
        setShowSecret(!showSecret);
    };

    if (loading) {
        return (
            <ui.Card>
                <h2 className={styles.card_title}>
                    <Settings size={18} />
                    Bot Authorization
                </h2>
                <div className={styles.loading}>Loading...</div>
            </ui.Card>
        );
    }

    return (
        <ui.Card>
            {/* Card header */}
            <h2 className={styles.card_title}>
                <Settings size={18} />
                Bot Authorization
            </h2>

            <div className={styles.content}>
                {/* Configuration status indicator - only show warning if not configured */}
                {!settings?.botTokenConfigured && (
                    <div className={styles.status_indicator}>
                        <div className={styles.status_warning}>
                            <AlertCircle size={16} />
                            <span>Bot token not configured</span>
                        </div>
                    </div>
                )}

                {/* Bot token field */}
                <div className={styles.field}>
                    <label className={styles.label}>
                        Bot Token
                    </label>

                    <div className={styles.input_group}>
                        <ui.Input
                            type="text"
                            value={tokenInput || (showToken && settings?.botToken ? settings.botToken : '')}
                            onChange={(e) => setTokenInput(e.target.value)}
                            placeholder={
                                showToken
                                    ? (settings?.botToken || '123456789:ABCdefGHIjklMNOpqrsTUVwxyz')
                                    : '••••••••••••••••••••••••'
                            }
                            disabled={isSaving || (showToken && settings?.botToken !== undefined && !tokenInput)}
                            aria-label="Bot token"
                        />
                        <button
                            type="button"
                            onClick={handleToggleTokenVisibility}
                            className={styles.visibility_toggle}
                            disabled={isSaving}
                            aria-label={showToken ? 'Hide token' : 'Show token'}
                        >
                            {showToken ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>

                    {/* Setup instructions - collapsible section directly under input */}
                    {!settings?.botTokenConfigured && (
                        <details className={styles.instructions}>
                            <summary className={styles.instructions_header}>
                                How to get a bot token
                            </summary>
                            <div className={styles.instructions_content}>
                                <ol className={styles.instructions_list}>
                                    <li>Open Telegram and message <code>@BotFather</code></li>
                                    <li>Send the <code>/newbot</code> command and follow the instructions</li>
                                    <li>Copy the bot token provided (format: <code>123456789:ABCdefGHIjklMNOpqrsTUVwxyz</code>)</li>
                                    <li>Paste it in the field above and click Save Settings</li>
                                </ol>
                                <p className={styles.instructions_note}>
                                    After configuring the token, don't forget to set up the webhook in the Webhook Configuration card below.
                                </p>
                            </div>
                        </details>
                    )}
                </div>

                {/* Webhook secret field */}
                <div className={styles.field}>
                    <label className={styles.label}>
                        Webhook Secret
                    </label>

                    <div className={styles.input_group}>
                        <ui.Input
                            type="text"
                            value={secretInput || (showSecret && settings?.webhookSecret ? settings.webhookSecret : '')}
                            onChange={(e) => setSecretInput(e.target.value)}
                            placeholder={
                                showSecret
                                    ? (settings?.webhookSecret || 'abc123def456...')
                                    : '••••••••••••••••••••••••'
                            }
                            disabled={isSaving || (showSecret && settings?.webhookSecret !== undefined && !secretInput)}
                            aria-label="Webhook secret"
                        />
                        <button
                            type="button"
                            onClick={handleToggleSecretVisibility}
                            className={styles.visibility_toggle}
                            disabled={isSaving}
                            aria-label={showSecret ? 'Hide secret' : 'Show secret'}
                        >
                            {showSecret ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                    </div>

                    {/* Generate button and instructions */}
                    <layout.Stack gap="sm">
                        <ui.Button
                            onClick={handleGenerateSecret}
                            variant="secondary"
                            size="sm"
                            disabled={isSaving}
                        >
                            Generate New Secret
                        </ui.Button>
                    </layout.Stack>

                    {/* Webhook secret instructions - collapsible section */}
                    {!settings?.webhookSecretConfigured && (
                        <details className={styles.instructions}>
                            <summary className={styles.instructions_header}>
                                What is a webhook secret?
                            </summary>
                            <div className={styles.instructions_content}>
                                <p className={styles.instructions_note}>
                                    The webhook secret is a security token that Telegram sends with every webhook request.
                                    It ensures that incoming requests are actually from Telegram's servers and not malicious actors.
                                </p>
                                <p className={styles.instructions_note}>
                                    Click "Generate New Secret" to create a secure random string, then save it below.
                                    You must configure this secret before the webhook can be deployed.
                                </p>
                            </div>
                        </details>
                    )}
                </div>

                {/* Save button - always visible */}
                <div className={styles.save_button_container}>
                    <ui.Button
                        onClick={handleSaveClick}
                        variant="primary"
                        size="md"
                        disabled={isSaving || (!tokenInput.trim() && !secretInput.trim())}
                        loading={isSaving}
                    >
                        Save Settings
                    </ui.Button>
                </div>

                {/* Feedback message (success or error) */}
                {feedback && (
                    <div className={feedback.type === 'success' ? styles.feedback_success : styles.feedback_error}>
                        {feedback.type === 'success' ? (
                            <CheckCircle size={16} />
                        ) : (
                            <AlertCircle size={16} />
                        )}
                        <span>{feedback.message}</span>
                    </div>
                )}
            </div>
        </ui.Card>
    );
}
