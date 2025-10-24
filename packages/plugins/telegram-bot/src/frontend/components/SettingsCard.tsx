import React from 'react';
import type { IFrontendPluginContext } from '@tronrelic/types';
import { Settings, CheckCircle, AlertCircle } from 'lucide-react';
import styles from './SettingsCard.module.css';

/**
 * Props for SettingsCard component.
 */
interface ISettingsCardProps {
    context: IFrontendPluginContext;
}

/**
 * Response from GET /plugins/telegram-bot/system/settings endpoint.
 * Contains current bot configuration including rate limiting settings.
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
 * Settings Card Component
 *
 * Provides configuration interface for bot behavior settings including rate limiting.
 * Allows administrators to control how many commands users can execute within a time window,
 * preventing spam and abuse without requiring backend code changes.
 *
 * Why this component exists:
 * Rate limiting is critical for preventing bot abuse, but hardcoded limits can't adapt to
 * different deployment scenarios. This card exposes runtime-configurable limits that admins
 * can tune based on observed usage patterns and abuse attempts.
 *
 * @param props - Component properties
 * @param props.context - Plugin context providing API client and UI components
 */
export function SettingsCard({ context }: ISettingsCardProps) {
    const { ui, api } = context;

    // State management
    const [loading, setLoading] = React.useState(true);
    const [settings, setSettings] = React.useState<ISettingsResponse | null>(null);
    const [rateLimitPerUser, setRateLimitPerUser] = React.useState<number>(10);
    const [rateLimitWindowMs, setRateLimitWindowMs] = React.useState<number>(60000);
    const [isSaving, setIsSaving] = React.useState(false);
    const [feedback, setFeedback] = React.useState<{ type: 'success' | 'error'; message: string } | null>(null);
    const [hasChanges, setHasChanges] = React.useState(false);

    /**
     * Fetches current bot settings from backend.
     *
     * Why fetch instead of hardcode:
     * Settings are stored in the database and can be modified at runtime.
     * The backend provides the current values which may have been changed
     * by other admins or previous sessions.
     */
    React.useEffect(() => {
        async function fetchSettings() {
            try {
                setLoading(true);
                const response = await api.get<{ success: boolean; settings: ISettingsResponse }>('/plugins/telegram-bot/system/settings');
                setSettings(response.settings);
                setRateLimitPerUser(response.settings.rateLimitPerUser);
                setRateLimitWindowMs(response.settings.rateLimitWindowMs);
            } catch (err) {
                console.error('Error fetching settings:', err);
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
     * Tracks whether user has made changes to form fields.
     *
     * Why track changes:
     * Provides visual feedback that settings need to be saved and enables/disables
     * the save button based on whether there are pending changes.
     */
    React.useEffect(() => {
        if (!settings) return;

        const changed =
            rateLimitPerUser !== settings.rateLimitPerUser ||
            rateLimitWindowMs !== settings.rateLimitWindowMs;

        setHasChanges(changed);
    }, [rateLimitPerUser, rateLimitWindowMs, settings]);

    /**
     * Validates rate limiting inputs before submission.
     *
     * Why validation matters:
     * Invalid values could break the bot (e.g., negative limits, zero window).
     * Validating before sending prevents unnecessary API calls and provides
     * immediate user feedback for common mistakes.
     *
     * @returns True if all inputs are valid
     */
    const validateInputs = (): boolean => {
        if (rateLimitPerUser < 1 || rateLimitPerUser > 100) {
            setFeedback({
                type: 'error',
                message: 'Rate limit per user must be between 1 and 100 commands'
            });
            return false;
        }

        if (rateLimitWindowMs < 10000 || rateLimitWindowMs > 300000) {
            setFeedback({
                type: 'error',
                message: 'Rate limit window must be between 10 and 300 seconds'
            });
            return false;
        }

        return true;
    };

    /**
     * Saves the updated settings to the backend.
     *
     * Why async API call:
     * The backend validates and persists these settings to the database.
     * After a successful save, settings take effect immediately for all
     * subsequent bot commands without requiring a restart.
     */
    const handleSaveClick = async () => {
        if (!validateInputs()) {
            return;
        }

        try {
            setIsSaving(true);
            setFeedback(null);

            await api.put('/plugins/telegram-bot/system/settings', {
                rateLimitPerUser,
                rateLimitWindowMs
            });

            // Refresh settings to confirm the update
            const response = await api.get<{ success: boolean; settings: ISettingsResponse }>('/plugins/telegram-bot/system/settings');
            setSettings(response.settings);
            setRateLimitPerUser(response.settings.rateLimitPerUser);
            setRateLimitWindowMs(response.settings.rateLimitWindowMs);

            setFeedback({
                type: 'success',
                message: 'Settings updated successfully!'
            });

            setHasChanges(false);

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
     * Resets inputs to currently saved values.
     *
     * Why reset button:
     * Allows users to quickly undo changes without reloading the page.
     * Provides a clear way to discard experimental values.
     */
    const handleResetClick = () => {
        if (!settings) return;

        setRateLimitPerUser(settings.rateLimitPerUser);
        setRateLimitWindowMs(settings.rateLimitWindowMs);
        setFeedback(null);
    };

    if (loading) {
        return (
            <ui.Card>
                <h2 className={styles.card_title}>
                    <Settings size={18} />
                    Settings
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
                Settings
            </h2>

            <div className={styles.content}>
                {/* Rate limiting section */}
                <div className={styles.section}>
                    <h3 className={styles.section_title}>Rate Limiting</h3>
                    <p className={styles.section_description}>
                        Control how many commands users can execute within a time window to prevent spam and abuse.
                    </p>

                    {/* Commands per user */}
                    <div className={styles.field}>
                        <label className={styles.label} htmlFor="rateLimitPerUser">
                            Commands per User
                        </label>
                        <div className={styles.input_with_unit}>
                            <ui.Input
                                id="rateLimitPerUser"
                                type="number"
                                value={rateLimitPerUser}
                                onChange={(e) => setRateLimitPerUser(parseInt(e.target.value, 10))}
                                min={1}
                                max={100}
                                step={1}
                                disabled={isSaving}
                                aria-label="Commands per user"
                            />
                            <span className={styles.unit}>commands</span>
                        </div>
                        <p className={styles.help_text}>
                            Maximum number of commands a single user can execute within the time window (1-100).
                        </p>
                    </div>

                    {/* Time window */}
                    <div className={styles.field}>
                        <label className={styles.label} htmlFor="rateLimitWindow">
                            Time Window
                        </label>
                        <div className={styles.input_with_unit}>
                            <ui.Input
                                id="rateLimitWindow"
                                type="number"
                                value={rateLimitWindowMs / 1000}
                                onChange={(e) => setRateLimitWindowMs(parseInt(e.target.value, 10) * 1000)}
                                min={10}
                                max={300}
                                step={10}
                                disabled={isSaving}
                                aria-label="Rate limit window in seconds"
                            />
                            <span className={styles.unit}>seconds</span>
                        </div>
                        <p className={styles.help_text}>
                            Time window for rate limiting (10-300 seconds). Users can execute up to the command limit within this window.
                        </p>
                    </div>

                    {/* Example calculation */}
                    <div className={styles.example}>
                        <strong>Current configuration:</strong> Users can execute up to{' '}
                        <strong>{rateLimitPerUser} commands</strong> every{' '}
                        <strong>{rateLimitWindowMs / 1000} seconds</strong>.
                    </div>
                </div>

                {/* Action buttons */}
                <div className={styles.button_row}>
                    <ui.Button
                        onClick={handleResetClick}
                        variant="secondary"
                        size="md"
                        disabled={isSaving || !hasChanges}
                    >
                        Reset
                    </ui.Button>
                    <ui.Button
                        onClick={handleSaveClick}
                        variant="primary"
                        size="md"
                        disabled={isSaving || !hasChanges}
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
