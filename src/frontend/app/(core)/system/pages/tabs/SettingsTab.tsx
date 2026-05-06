'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Save } from 'lucide-react';
import type { IPageSettings } from '@/types';
import styles from './SettingsTab.module.css';

interface SettingsTabProps {
    token: string;
}

/**
 * Pages settings — pages-only concerns. Currently the only page-level
 * setting is the route blacklist that prevents custom slugs from shadowing
 * core URLs. File-upload policy lives at /system/files.
 */
export function SettingsTab({ token }: SettingsTabProps) {
    const [settings, setSettings] = useState<IPageSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const [blacklistedRoutes, setBlacklistedRoutes] = useState('');

    const fetchSettings = useCallback(async () => {
        try {
            const response = await fetch('/api/admin/pages/settings', {
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                }
            });

            if (!response.ok) {
                throw new Error(`Failed to fetch settings: ${response.statusText}`);
            }

            const data: IPageSettings = await response.json();
            setSettings(data);
            setBlacklistedRoutes(data.blacklistedRoutes.join('\n'));
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch settings');
        } finally {
            setLoading(false);
        }
    }, [token]);

    const saveSettings = async () => {
        setSaving(true);
        setError(null);
        setSuccess(false);

        try {
            const blacklistedRoutesArray = blacklistedRoutes
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            const updates: Partial<IPageSettings> = {
                blacklistedRoutes: blacklistedRoutesArray
            };

            const response = await fetch('/api/admin/pages/settings', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'x-admin-token': token
                },
                body: JSON.stringify(updates)
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.message || `Failed to save settings: ${response.statusText}`);
            }

            const updatedSettings: IPageSettings = await response.json();
            setSettings(updatedSettings);
            setSuccess(true);

            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    useEffect(() => {
        void fetchSettings();
    }, [fetchSettings]);

    if (loading) {
        return (
            <Card padding="lg">
                <p>Loading settings...</p>
            </Card>
        );
    }

    return (
        <div className={styles.container}>
            {error && (
                <Card tone="muted" padding="md">
                    <p className={styles.error}>{error}</p>
                </Card>
            )}

            {success && (
                <Card tone="accent" padding="md">
                    <p className={styles.success}>Settings saved successfully!</p>
                </Card>
            )}

            <Card padding="lg">
                <div className={styles.form}>
                    <div className={styles.field}>
                        <label htmlFor="blacklisted-routes" className={styles.label}>
                            Blacklisted Routes
                        </label>
                        <p className={styles.description}>
                            Route patterns that custom pages cannot use (one per line).
                            Prevents conflicts with system routes.
                        </p>
                        <textarea
                            id="blacklisted-routes"
                            className={styles.textarea}
                            value={blacklistedRoutes}
                            onChange={e => setBlacklistedRoutes(e.target.value)}
                            rows={6}
                            placeholder="^/api/.*&#10;^/system/.*&#10;^/_next/.*&#10;^/uploads"
                        />
                    </div>

                    <div className={styles.actions}>
                        <Button
                            variant="primary"
                            size="lg"
                            icon={<Save size={18} />}
                            onClick={() => void saveSettings()}
                            loading={saving}
                        >
                            Save Settings
                        </Button>
                    </div>
                </div>
            </Card>

            {settings && (
                <Card tone="muted" padding="md">
                    <h3 className={styles.section_title}>Current Settings</h3>
                    <div className={styles.settings_display}>
                        <div className={styles.setting_row}>
                            <span className={styles.setting_label}>Total Blacklisted Routes:</span>
                            <span className={styles.setting_value}>{settings.blacklistedRoutes.length}</span>
                        </div>
                        <div className={styles.setting_row}>
                            <span className={styles.setting_label}>Last Updated:</span>
                            <span className={styles.setting_value}>
                                {new Date(settings.updatedAt).toLocaleString()}
                            </span>
                        </div>
                    </div>
                </Card>
            )}
        </div>
    );
}
