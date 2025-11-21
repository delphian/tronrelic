'use client';

import type { IFrontendPluginContext } from '@tronrelic/types';
import type { IWhaleAlertsConfig } from '../../../shared/types';

interface WhaleTelegramSettingsProps {
    config: IWhaleAlertsConfig;
    onChange: (config: IWhaleAlertsConfig) => void;
    context: IFrontendPluginContext;
}

/**
 * Whale Telegram Settings Component.
 *
 * Provides controls for configuring Telegram notification settings for whale
 * alerts. Uses the injected UI components from the frontend plugin context.
 *
 * @param props - Component props
 * @param props.config - Current whale alerts configuration
 * @param props.onChange - Callback when configuration changes
 * @param props.context - Frontend plugin context with UI components
 */
export function WhaleTelegramSettings({ config, onChange, context }: WhaleTelegramSettingsProps) {
    const { ui } = context;

    const handleToggleTelegram = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange({ ...config, telegramEnabled: e.target.checked });
    };

    const handleChannelIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange({ ...config, telegramChannelId: e.target.value });
    };

    const handleThreadIdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        onChange({
            ...config,
            telegramThreadId: value ? parseInt(value, 10) : undefined
        });
    };

    return (
        <ui.Card>
            <div className="whale-admin-section">
                <div className="whale-admin-section__header">
                    <h3 className="whale-admin-section__title">Telegram Notifications</h3>
                    <p className="whale-admin-section__description">
                        Send whale transaction alerts to a Telegram channel or group. Requires
                        TELEGRAM_TOKEN to be configured in backend environment variables.
                    </p>
                </div>

                <div className="whale-admin-section__content">
                    <div className="form-group">
                        <label className="form-checkbox">
                            <input
                                type="checkbox"
                                checked={config.telegramEnabled}
                                onChange={handleToggleTelegram}
                            />
                            <span>Enable Telegram Notifications</span>
                        </label>
                        <p className="form-help">
                            Whale transactions will be sent to the configured Telegram channel
                        </p>
                    </div>

                    {config.telegramEnabled && (
                        <>
                            <div className="form-group">
                                <label htmlFor="telegram-channel-id" className="form-label">
                                    Channel ID
                                </label>
                                <ui.Input
                                    id="telegram-channel-id"
                                    type="text"
                                    value={config.telegramChannelId || ''}
                                    onChange={handleChannelIdChange}
                                    placeholder="@channel_name or -1001234567890"
                                />
                                <p className="form-help">
                                    Telegram channel username (e.g., @mychannel) or numeric ID (e.g., -1001234567890)
                                </p>
                            </div>

                            <div className="form-group">
                                <label htmlFor="telegram-thread-id" className="form-label">
                                    Thread ID (Optional)
                                </label>
                                <ui.Input
                                    id="telegram-thread-id"
                                    type="number"
                                    value={config.telegramThreadId?.toString() || ''}
                                    onChange={handleThreadIdChange}
                                    placeholder="Leave empty for main channel"
                                />
                                <p className="form-help">
                                    Forum topic ID if posting to a specific thread in a forum-enabled group
                                </p>
                            </div>

                            <ui.Badge tone="neutral">
                                Notifications sent every 30 seconds
                            </ui.Badge>
                        </>
                    )}
                </div>
            </div>
        </ui.Card>
    );
}
