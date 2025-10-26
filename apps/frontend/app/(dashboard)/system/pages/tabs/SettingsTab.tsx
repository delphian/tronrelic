'use client';

import { useState, useEffect, useCallback } from 'react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Save } from 'lucide-react';
import type { IPageSettings } from '@tronrelic/types';
import styles from './SettingsTab.module.css';

/**
 * Props for SettingsTab component.
 */
interface SettingsTabProps {
    token: string;
}

/**
 * Settings tab - Configure module settings.
 *
 * Provides configuration management including:
 * - Blacklisted route patterns
 * - Max file size limits
 * - Allowed file extensions
 * - Filename sanitization pattern
 * - Storage provider selection
 */
export function SettingsTab({ token }: SettingsTabProps) {
    const [settings, setSettings] = useState<IPageSettings | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    // Form state
    const [blacklistedRoutes, setBlacklistedRoutes] = useState('');
    const [maxFileSizeMB, setMaxFileSizeMB] = useState('10');
    const [allowedExtensions, setAllowedExtensions] = useState('');
    const [sanitizationPattern, setSanitizationPattern] = useState('[^a-z0-9-_.]');
    const [storageProvider, setStorageProvider] = useState<'local' | 's3' | 'cloudflare'>('local');

    /**
     * Fetch current settings from API.
     *
     * Loads settings and populates form fields with current values.
     */
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

            // Populate form fields
            setBlacklistedRoutes(data.blacklistedRoutes.join('\n'));
            setMaxFileSizeMB((data.maxFileSize / (1024 * 1024)).toString());
            setAllowedExtensions(data.allowedFileExtensions.join(', '));
            setSanitizationPattern(data.filenameSanitizationPattern);
            setStorageProvider(data.storageProvider);

            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch settings');
        } finally {
            setLoading(false);
        }
    }, [token]);

    /**
     * Save settings updates to API.
     *
     * Validates and transforms form inputs before sending PATCH request.
     * Shows success feedback on completion.
     */
    const saveSettings = async () => {
        setSaving(true);
        setError(null);
        setSuccess(false);

        try {
            // Parse and validate inputs
            const blacklistedRoutesArray = blacklistedRoutes
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0);

            const maxFileSizeBytes = parseFloat(maxFileSizeMB) * 1024 * 1024;
            if (isNaN(maxFileSizeBytes) || maxFileSizeBytes <= 0) {
                throw new Error('Max file size must be a positive number');
            }

            const allowedExtensionsArray = allowedExtensions
                .split(',')
                .map(ext => ext.trim())
                .filter(ext => ext.length > 0)
                .map(ext => ext.startsWith('.') ? ext : `.${ext}`);

            // Build update payload
            const updates: Partial<IPageSettings> = {
                blacklistedRoutes: blacklistedRoutesArray,
                maxFileSize: Math.floor(maxFileSizeBytes),
                allowedFileExtensions: allowedExtensionsArray,
                filenameSanitizationPattern: sanitizationPattern,
                storageProvider
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

            // Clear success message after 3 seconds
            setTimeout(() => setSuccess(false), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to save settings');
        } finally {
            setSaving(false);
        }
    };

    // Initial load
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
            {/* Error Display */}
            {error && (
                <Card tone="muted" padding="md">
                    <p className={styles.error}>{error}</p>
                </Card>
            )}

            {/* Success Display */}
            {success && (
                <Card tone="accent" padding="md">
                    <p className={styles.success}>Settings saved successfully!</p>
                </Card>
            )}

            {/* Settings Form */}
            <Card padding="lg">
                <div className={styles.form}>
                    {/* Blacklisted Routes */}
                    <div className={styles.field}>
                        <label htmlFor="blacklisted-routes" className={styles.label}>
                            Blacklisted Routes
                        </label>
                        <p className={styles.description}>
                            Route patterns that custom pages cannot use (one per line). Prevents conflicts with system routes.
                        </p>
                        <textarea
                            id="blacklisted-routes"
                            className={styles.textarea}
                            value={blacklistedRoutes}
                            onChange={e => setBlacklistedRoutes(e.target.value)}
                            rows={6}
                            placeholder="/api&#10;/system&#10;/_next&#10;/uploads"
                        />
                    </div>

                    {/* Max File Size */}
                    <div className={styles.field}>
                        <label htmlFor="max-file-size" className={styles.label}>
                            Max File Size (MB)
                        </label>
                        <p className={styles.description}>
                            Maximum file size allowed for uploads in megabytes.
                        </p>
                        <Input
                            id="max-file-size"
                            type="number"
                            step="0.1"
                            min="0.1"
                            value={maxFileSizeMB}
                            onChange={e => setMaxFileSizeMB(e.target.value)}
                        />
                    </div>

                    {/* Allowed Extensions */}
                    <div className={styles.field}>
                        <label htmlFor="allowed-extensions" className={styles.label}>
                            Allowed File Extensions
                        </label>
                        <p className={styles.description}>
                            Comma-separated list of allowed file extensions (with or without leading dot).
                        </p>
                        <Input
                            id="allowed-extensions"
                            type="text"
                            value={allowedExtensions}
                            onChange={e => setAllowedExtensions(e.target.value)}
                            placeholder=".png, .jpg, .jpeg, .ico, .svg"
                        />
                    </div>

                    {/* Sanitization Pattern */}
                    <div className={styles.field}>
                        <label htmlFor="sanitization-pattern" className={styles.label}>
                            Filename Sanitization Pattern
                        </label>
                        <p className={styles.description}>
                            Regular expression pattern for sanitizing filenames. Characters matching this pattern are replaced with hyphens.
                        </p>
                        <Input
                            id="sanitization-pattern"
                            type="text"
                            value={sanitizationPattern}
                            onChange={e => setSanitizationPattern(e.target.value)}
                            placeholder="[^a-z0-9-_.]"
                            className={styles.code_input}
                        />
                    </div>

                    {/* Storage Provider */}
                    <div className={styles.field}>
                        <label htmlFor="storage-provider" className={styles.label}>
                            Storage Provider
                        </label>
                        <p className={styles.description}>
                            Select where uploaded files are stored. Currently only local filesystem is supported.
                        </p>
                        <select
                            id="storage-provider"
                            value={storageProvider}
                            onChange={e => setStorageProvider(e.target.value as typeof storageProvider)}
                            className={styles.select}
                            disabled
                        >
                            <option value="local">Local Filesystem</option>
                            <option value="s3" disabled>AWS S3 (Coming Soon)</option>
                            <option value="cloudflare" disabled>Cloudflare R2 (Coming Soon)</option>
                        </select>
                    </div>

                    {/* Save Button */}
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

            {/* Current Settings Display */}
            {settings && (
                <Card tone="muted" padding="md">
                    <h3 className={styles.section_title}>Current Settings</h3>
                    <div className={styles.settings_display}>
                        <div className={styles.setting_row}>
                            <span className={styles.setting_label}>Total Blacklisted Routes:</span>
                            <span className={styles.setting_value}>{settings.blacklistedRoutes.length}</span>
                        </div>
                        <div className={styles.setting_row}>
                            <span className={styles.setting_label}>Max File Size:</span>
                            <span className={styles.setting_value}>
                                {(settings.maxFileSize / (1024 * 1024)).toFixed(1)} MB
                            </span>
                        </div>
                        <div className={styles.setting_row}>
                            <span className={styles.setting_label}>Allowed Extensions:</span>
                            <span className={styles.setting_value}>{settings.allowedFileExtensions.length} types</span>
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
