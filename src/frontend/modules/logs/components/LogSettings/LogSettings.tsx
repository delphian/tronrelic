'use client';

import { useCallback, useEffect, useId, useState } from 'react';
import type { LogLevelName } from '@/types';
import { Button } from '../../../../components/ui/Button';
import { Select } from '../../../../components/ui/Select';
import { useToast } from '../../../../components/ui/ToastProvider';
import styles from './LogSettings.module.scss';

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

/** Recording levels in the order the dropdown lists them, with what each one keeps. */
const LEVEL_OPTIONS: ReadonlyArray<{ value: LogLevelName; label: string; help: string }> = [
    { value: 'trace', label: 'Trace', help: 'Records everything, including internal traces. Use briefly; volume is very high.' },
    { value: 'debug', label: 'Debug', help: 'Records debugging detail and above. Useful while troubleshooting.' },
    { value: 'info', label: 'Info', help: 'Records normal operational messages and above. Recommended for production.' },
    { value: 'warn', label: 'Warning', help: 'Records warnings, errors, and fatal failures only.' },
    { value: 'error', label: 'Error', help: 'Records errors and fatal failures only.' },
    { value: 'fatal', label: 'Fatal', help: 'Records fatal failures only.' },
    { value: 'silent', label: 'Silent', help: 'Records nothing, in the log files or in the database.' }
];

/**
 * LogSettings Component
 *
 * The recording level for the whole backend: entries below it are neither
 * written to the log files nor saved to the database, so they never reach
 * any log viewer. It is a deployment setting rather than a view filter, which
 * is why it sits apart from the viewer's severity chips — those only choose
 * which saved entries to show.
 *
 * Laid out as one compact row (name and what the selected level keeps on the
 * left, the dropdown and Save on the right) because an operator changes it
 * rarely and it should not compete with the entries above it. A successful
 * save confirms with a toast; a failed read or save shows an inline alert.
 *
 * **Data flow:** reads `GET /api/admin/system/config/system` on mount, and
 * `PATCH`es `logLevel` on save. The backend applies the new level to the
 * running logger immediately, without a restart.
 *
 * **Security:**
 * Authorization rides the same-origin Better Auth session cookie;
 * the backend `requireAdmin` middleware resolves it per request.
 */
export function LogSettings() {
    const [config, setConfig] = useState<SystemConfig | null>(null);
    const [selectedLevel, setSelectedLevel] = useState<LogLevelName>('info');
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const headingId = useId();
    const { push } = useToast();

    /**
     * Fetches current system configuration from the backend.
     *
     * Retrieves SystemConfig including the current logLevel setting.
     * If the fetch fails, shows the reason and keeps the control disabled.
     */
    const fetchConfig = useCallback(async () => {
        setLoading(true);
        setError(null);

        try {
            const response = await fetch(`/api/admin/system/config/system`, {
                method: 'GET',
                headers: { 'Content-Type': 'application/json' }
            });

            if (!response.ok) {
                throw new Error(`Could not read the recording level (${response.status}).`);
            }

            const data = await response.json();

            if (data.success && data.config) {
                setConfig(data.config);
                setSelectedLevel(data.config.logLevel || 'info');
            } else {
                throw new Error('The server returned an unexpected response.');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not read the recording level.');
        } finally {
            setLoading(false);
        }
    }, []);

    /**
     * Saves the selected recording level to SystemConfig.
     *
     * The backend controller applies the new level to the running logger after
     * saving, so the change takes effect immediately without a restart.
     */
    const handleSave = async () => {
        if (!config) return;

        setSaving(true);
        setError(null);

        try {
            const response = await fetch(`/api/admin/system/config/system`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logLevel: selectedLevel })
            });

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Could not save the recording level (${response.status}).`);
            }

            const data = await response.json();

            if (data.success && data.config) {
                setConfig(data.config);
                const label = LEVEL_OPTIONS.find(option => option.value === selectedLevel)?.label ?? selectedLevel;
                push({ tone: 'success', title: `Recording level set to ${label}` });
            } else {
                throw new Error('The server returned an unexpected response.');
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Could not save the recording level.');
        } finally {
            setSaving(false);
        }
    };

    // Fetch config on mount
    useEffect(() => {
        void fetchConfig();
    }, [fetchConfig]);

    const hasChanges = config !== null && selectedLevel !== config.logLevel;
    const help = LEVEL_OPTIONS.find(option => option.value === selectedLevel)?.help;

    return (
        <section className={styles.settings} aria-labelledby={headingId}>
            <div className={styles.text}>
                <h2 id={headingId} className={styles.title}>Recording level</h2>
                <p className={styles.help}>{help}</p>
            </div>

            <div className={styles.form}>
                <Select
                    size="sm"
                    aria-labelledby={headingId}
                    value={selectedLevel}
                    onChange={e => setSelectedLevel(e.target.value as LogLevelName)}
                    disabled={loading || saving || config === null}
                >
                    {LEVEL_OPTIONS.map(option => (
                        <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                </Select>
                <Button
                    variant="primary"
                    size="sm"
                    onClick={handleSave}
                    loading={saving}
                    disabled={loading || !hasChanges}
                >
                    Save
                </Button>
            </div>

            {error && <div className={`alert ${styles.error}`} role="alert">{error}</div>}
        </section>
    );
}
