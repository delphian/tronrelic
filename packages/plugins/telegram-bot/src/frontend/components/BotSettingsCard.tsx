import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { Settings, Eye, EyeOff, CheckCircle, AlertCircle } from 'lucide-react';
import styles from './BotSettingsCard.module.css';

/**
 * Props for BotSettingsCard component.
 */
interface IBotSettingsCardProps {
    context: IFrontendPluginContext;
}

/**
 * Response from GET /plugins/telegram-bot/system/settings endpoint.
 * Contains current bot configuration including masked token and rate limit settings.
 */
interface ISettingsResponse {
    botToken: string;
    botTokenConfigured: boolean;
    rateLimitPerUser: number;
    rateLimitWindowMs: number;
}

/**
 * Bot Settings Card Component
 *
 * Provides configuration interface for the Telegram bot token and related settings.
 * Allows administrators to view, edit, and update the bot token without requiring
 * backend server restarts or direct environment variable access.
 *
 * Why this component exists:
 * Administrators need a way to configure the bot token through the UI instead of
 * editing environment files and restarting services. This card provides a secure
 * interface for token management with proper masking, validation, and feedback.
 *
 * @param props - Component properties
 * @param props.context - Plugin context providing API client and UI components
 */
export function BotSettingsCard({ context }: IBotSettingsCardProps) {
    const { ui, api } = context;

    // State management
    const [loading, setLoading] = React.useState(true);
    const [showToken, setShowToken] = React.useState(false);
    const [settings, setSettings] = React.useState<ISettingsResponse | null>(null);
    const [tokenInput, setTokenInput] = React.useState('');
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
     * Saves the new bot token to the backend.
     *
     * Why async API call:
     * The backend stores the token securely and validates it with Telegram's API.
     * After a successful save, the webhook configuration may need to be updated,
     * and the backend handles that automatically.
     */
    const handleSaveClick = async () => {
        // Validate token format
        if (!validateTokenFormat(tokenInput)) {
            setFeedback({
                type: 'error',
                message: 'Invalid token format. Expected format: 123456789:ABCdefGHIjklMNOpqrsTUVwxyz'
            });
            return;
        }

        try {
            setIsSaving(true);
            setFeedback(null);

            await api.put('/plugins/telegram-bot/system/settings', {
                botToken: tokenInput
            });

            // Refresh settings to get the new masked token
            const response = await api.get<{ success: boolean; settings: ISettingsResponse }>('/plugins/telegram-bot/system/settings');
            setSettings(response.settings);

            setFeedback({
                type: 'success',
                message: 'Bot token updated successfully!'
            });

            setTokenInput('');
            setShowToken(false);

            // Clear success message after 5 seconds
            setTimeout(() => setFeedback(null), 5000);
        } catch (err: any) {
            console.error('Error saving bot token:', err);
            setFeedback({
                type: 'error',
                message: err.response?.data?.error || err.message || 'Failed to save bot token'
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
    const handleToggleVisibility = () => {
        setShowToken(!showToken);
    };

    if (loading) {
        return (
            <ui.Card>
                <h2 className={styles.card_title}>
                    <Settings size={18} />
                    Bot Settings
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
                Bot Settings
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
                            type={showToken ? 'text' : 'password'}
                            value={tokenInput}
                            onChange={(e) => setTokenInput(e.target.value)}
                            placeholder={
                                showToken
                                    ? (settings?.botToken || '123456789:ABCdefGHIjklMNOpqrsTUVwxyz')
                                    : '••••••••••••••••••••••••'
                            }
                            disabled={isSaving}
                            aria-label="Bot token"
                        />
                        <button
                            type="button"
                            onClick={handleToggleVisibility}
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
                                    After configuring the token, don't forget to set up the webhook in the Webhook Configuration card.
                                </p>
                            </div>
                        </details>
                    )}

                    {/* Save button - always visible */}
                    <div className={styles.save_button_container}>
                        <ui.Button
                            onClick={handleSaveClick}
                            variant="primary"
                            size="md"
                            disabled={isSaving || !tokenInput.trim() || !validateTokenFormat(tokenInput)}
                            loading={isSaving}
                        >
                            Save Settings
                        </ui.Button>
                    </div>
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
