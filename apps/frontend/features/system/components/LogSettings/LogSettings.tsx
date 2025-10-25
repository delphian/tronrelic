'use client';

import React, { useEffect, useState } from 'react';
import type { LogLevelName } from '@tronrelic/types';
import { config as runtimeConfig } from '../../../../lib/config';
import { Button } from '../../../../components/ui/Button';
import styles from './LogSettings.module.css';

/**
 * System configuration interface matching backend ISystemConfig.
 */
interface SystemConfig {
    key: string;
    siteUrl: string;
    systemLogsMaxCount: number;
    systemLogsRetentionDays: number;
    logLevel: LogLevelName;
    updatedAt: string;
    updatedBy?: string;
}

interface Props {
    token: string;
}

/**
 * LogSettings Component
 *
 * Admin configuration panel for controlling SystemLogService logging behavior.
 * Allows runtime adjustment of log verbosity without requiring backend restarts.
 *
 * **Key Features:**
 * - Dropdown selection for log level (trace through silent)
 * - Save button with loading state and error feedback
 * - Real-time application of changes to backend logger
 * - Displays current log level from SystemConfig database
 *
 * **Log Level Impacts:**
 * - Changes affect file/console output only (not MongoDB persistence)
 * - error/warn/fatal always save to database regardless of level
 * - Higher verbosity (trace/debug) useful for debugging production issues
 * - Lower verbosity (warn/error) reduces log file noise
 *
 * **Data Flow:**
 * 1. Component fetches current config on mount
 * 2. User selects new log level from dropdown
 * 3. Save button sends PATCH /admin/system/config/system
 * 4. Backend updates SystemConfig and applies level to SystemLogService
 * 5. Component shows success/error feedback
 *
 * **Security:**
 * Requires admin token authentication via X-Admin-Token header.
 *
 * @param {Props} props - Component props
 * @param {string} props.token - Admin authentication token for API requests
 */
export function LogSettings({ token }: Props) {
    const [config, setConfig] = useState<SystemConfig | null>(null);
    const [selectedLevel, setSelectedLevel] = useState<LogLevelName>('info');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    /**
     * Fetches current system configuration from the backend.
     *
     * Retrieves SystemConfig including the current logLevel setting.
     * If the fetch fails, displays an error message and keeps the form disabled.
     */
    const fetchConfig = async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/system/config/system`, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch config: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success && data.config) {
                setConfig(data.config);
                setSelectedLevel(data.config.logLevel || 'info');
            } else {
                throw new Error('Invalid response format');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch configuration');
        } finally {
            setLoading(false);
        }
    };

    /**
     * Saves the selected log level to SystemConfig and applies it to the logger.
     *
     * Sends PATCH request to update SystemConfig.logLevel. The backend controller
     * automatically applies the new level to SystemLogService after saving, ensuring
     * the change takes effect immediately without requiring a restart.
     */
    const handleSave = async () => {
        if (!config) return;

        setSaving(true);
        setError(null);
        setSuccessMessage(null);

        try {
            const response = await fetch(`${runtimeConfig.apiUrl}/admin/system/config/system`, {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Token': token
                },
                body: JSON.stringify({ logLevel: selectedLevel })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Failed to update config: ${response.statusText}`);
            }

            const data = await response.json();

            if (data.success && data.config) {
                setConfig(data.config);
                setSuccessMessage(`Log level updated to "${selectedLevel}"`);

                // Clear success message after 3 seconds
                setTimeout(() => setSuccessMessage(null), 3000);
            } else {
                throw new Error('Invalid response format');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save configuration');
        } finally {
            setSaving(false);
        }
    };

    // Fetch config on mount
    useEffect(() => {
        void fetchConfig();
    }, [token]);

    // Check if current selection differs from saved config
    const hasChanges = config && selectedLevel !== config.logLevel;

    return (
        <div className={`surface surface--padding-md ${styles.container}`}>
            <h3 className={styles.title}>Log Settings</h3>
            <p className={styles.description}>
                Control the minimum log level for file and console output. Changes apply immediately without requiring a restart.
            </p>

            {error && (
                <div className={styles.error}>
                    <strong>Error:</strong> {error}
                </div>
            )}

            {successMessage && (
                <div className={styles.success}>
                    <strong>Success:</strong> {successMessage}
                </div>
            )}

            <div className={styles.form}>
                <div className={styles.field}>
                    <label htmlFor="log-level" className={styles.label}>
                        Log Level:
                    </label>
                    <select
                        id="log-level"
                        className={styles.select}
                        value={selectedLevel}
                        onChange={e => setSelectedLevel(e.target.value as LogLevelName)}
                        disabled={loading || saving}
                    >
                        <option value="trace">Trace (Most Verbose)</option>
                        <option value="debug">Debug</option>
                        <option value="info">Info (Default)</option>
                        <option value="warn">Warn</option>
                        <option value="error">Error</option>
                        <option value="fatal">Fatal</option>
                        <option value="silent">Silent (Suppresses All Output)</option>
                    </select>
                    <p className={styles.help_text}>
                        {selectedLevel === 'trace' && 'Most verbose level. Includes all internal debug traces.'}
                        {selectedLevel === 'debug' && 'Development debugging information. Useful for troubleshooting.'}
                        {selectedLevel === 'info' && 'Normal operational messages. Recommended for production.'}
                        {selectedLevel === 'warn' && 'Warning conditions that need attention. Reduces log noise.'}
                        {selectedLevel === 'error' && 'Only error conditions. Minimal logging.'}
                        {selectedLevel === 'fatal' && 'Only critical failures. Extremely minimal logging.'}
                        {selectedLevel === 'silent' && 'Suppresses all file/console output. MongoDB logging still works.'}
                    </p>
                </div>

                <div className={styles.actions}>
                    <Button
                        variant="primary"
                        size="md"
                        onClick={handleSave}
                        disabled={loading || saving || !hasChanges}
                    >
                        {saving ? 'Saving...' : 'Save Changes'}
                    </Button>
                    {hasChanges && (
                        <span className={styles.unsaved_indicator}>
                            Unsaved changes
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
