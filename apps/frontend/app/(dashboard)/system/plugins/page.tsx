'use client';

import { useEffect, useState } from 'react';
import { config as runtimeConfig } from '../../../../lib/config';
import { useSystemAuth } from '../../../../features/system';
import { Badge } from '../../../../components/ui/Badge';
import type { IPluginInfo } from '@tronrelic/types';
import styles from './PluginsManagementPage.module.css';

/**
 * Plugin card component for managing individual plugin state.
 *
 * Displays plugin metadata, installation status, and action buttons for install,
 * uninstall, enable, and disable operations. Requires confirmation clicks before
 * executing state-changing operations to prevent accidental changes.
 *
 * @param props - Component props
 * @param props.pluginInfo - Plugin manifest and metadata
 * @param props.onInstall - Callback when install button is confirmed
 * @param props.onUninstall - Callback when uninstall button is confirmed
 * @param props.onEnable - Callback when enable button is confirmed
 * @param props.onDisable - Callback when disable button is confirmed
 * @param props.isLoading - Whether any operation is in progress
 */
function PluginCard({ pluginInfo, onInstall, onUninstall, onEnable, onDisable, isLoading }: {
    pluginInfo: IPluginInfo;
    onInstall: (pluginId: string) => void;
    onUninstall: (pluginId: string) => void;
    onEnable: (pluginId: string) => void;
    onDisable: (pluginId: string) => void;
    isLoading: boolean;
}) {
    const { manifest, metadata } = pluginInfo;
    const [showConfirm, setShowConfirm] = useState<'install' | 'uninstall' | 'enable' | 'disable' | null>(null);

    const handleInstall = () => {
        if (showConfirm === 'install') {
            onInstall(manifest.id);
            setShowConfirm(null);
        } else {
            setShowConfirm('install');
        }
    };

    const handleUninstall = () => {
        if (showConfirm === 'uninstall') {
            onUninstall(manifest.id);
            setShowConfirm(null);
        } else {
            setShowConfirm('uninstall');
        }
    };

    const handleEnable = () => {
        if (showConfirm === 'enable') {
            onEnable(manifest.id);
            setShowConfirm(null);
        } else {
            setShowConfirm('enable');
        }
    };

    const handleDisable = () => {
        if (showConfirm === 'disable') {
            onDisable(manifest.id);
            setShowConfirm(null);
        } else {
            setShowConfirm('disable');
        }
    };

    const canInstall = !metadata.installed;
    const canUninstall = metadata.installed;
    const canEnable = metadata.installed && !metadata.enabled;
    const canDisable = metadata.enabled;

    return (
        <div className={styles.plugin_card}>
            <div className={styles.plugin_header}>
                <div className={styles.plugin_info}>
                    <h3 className={styles.plugin_title}>{manifest.title}</h3>
                    <p className={styles.plugin_meta}>
                        {manifest.id} • v{manifest.version}
                    </p>
                </div>
                <div className={styles.plugin_badges}>
                    <Badge tone={metadata.installed ? 'success' : 'neutral'}>
                        {metadata.installed ? 'Installed' : 'Not Installed'}
                    </Badge>
                    <Badge tone={metadata.enabled ? 'neutral' : 'neutral'}>
                        {metadata.enabled ? 'Enabled' : 'Disabled'}
                    </Badge>
                </div>
            </div>

            {manifest.description && (
                <p className={styles.plugin_description}>
                    {manifest.description}
                </p>
            )}

            <div className={styles.plugin_details}>
                {manifest.author && (
                    <div>
                        <span className={styles.plugin_detail_label}>Author:</span> {manifest.author}
                    </div>
                )}
                {manifest.license && (
                    <div>
                        <span className={styles.plugin_detail_label}>License:</span> {manifest.license}
                    </div>
                )}
                <div>
                    <span className={styles.plugin_detail_label}>Backend:</span> {manifest.backend ? 'Yes' : 'No'}
                </div>
                <div>
                    <span className={styles.plugin_detail_label}>Frontend:</span> {manifest.frontend ? 'Yes' : 'No'}
                </div>
            </div>

            {metadata.lastError && (
                <div className={styles.plugin_error}>
                    <div className={styles.plugin_error_title}>Error:</div>
                    <p className={styles.plugin_error_message}>{metadata.lastError}</p>
                    {metadata.lastErrorAt && (
                        <p className={styles.plugin_error_timestamp}>
                            {new Date(metadata.lastErrorAt).toLocaleString()}
                        </p>
                    )}
                </div>
            )}

            <div className={styles.plugin_actions}>
                {showConfirm ? (
                    <>
                        <button
                            onClick={() => {
                                if (showConfirm === 'install') handleInstall();
                                if (showConfirm === 'uninstall') handleUninstall();
                                if (showConfirm === 'enable') handleEnable();
                                if (showConfirm === 'disable') handleDisable();
                            }}
                            disabled={isLoading}
                            className={`${styles.plugin_button} ${styles.plugin_button_confirm}`}
                        >
                            Confirm {showConfirm}
                        </button>
                        <button
                            onClick={() => setShowConfirm(null)}
                            disabled={isLoading}
                            className={`${styles.plugin_button} ${styles.plugin_button_cancel}`}
                        >
                            Cancel
                        </button>
                    </>
                ) : (
                    <>
                        <button
                            onClick={handleInstall}
                            disabled={!canInstall || isLoading}
                            className={`${styles.plugin_button} ${canInstall ? styles.plugin_button_install : styles.plugin_button_disabled}`}
                        >
                            Install
                        </button>
                        <button
                            onClick={handleUninstall}
                            disabled={!canUninstall || isLoading}
                            className={`${styles.plugin_button} ${canUninstall ? styles.plugin_button_uninstall : styles.plugin_button_disabled}`}
                        >
                            Uninstall
                        </button>
                        <button
                            onClick={handleEnable}
                            disabled={!canEnable || isLoading}
                            className={`${styles.plugin_button} ${canEnable ? styles.plugin_button_enable : styles.plugin_button_disabled}`}
                        >
                            Enable
                        </button>
                        <button
                            onClick={handleDisable}
                            disabled={!canDisable || isLoading}
                            className={`${styles.plugin_button} ${canDisable ? styles.plugin_button_disable : styles.plugin_button_disabled}`}
                        >
                            Disable
                        </button>
                        {manifest.adminUrl && (
                            <a
                                href={manifest.adminUrl}
                                className={`${styles.plugin_button} ${styles.plugin_button_settings}`}
                            >
                                Settings
                            </a>
                        )}
                    </>
                )}
            </div>
        </div>
    );
}

/**
 * Plugin management page.
 *
 * Displays all discovered plugins with installation, enable, and disable controls.
 * Provides aggregate statistics for total, installed, enabled, and error counts.
 * Requires admin authentication via shared SystemAuth context.
 */
export default function PluginsManagementPage() {
    const { token } = useSystemAuth();
    const [plugins, setPlugins] = useState<IPluginInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    useEffect(() => {
        fetchPlugins();
    }, []);

    const fetchPlugins = async () => {
        try {
            setIsLoading(true);
            setError(null);
            const response = await fetch(`${runtimeConfig.apiBaseUrl}/plugin-management/all`, {
                headers: {
                    'Authorization': `Bearer ${token}`
                }
            });

            if (!response.ok) {
                throw new Error('Failed to fetch plugins');
            }

            const data = await response.json();
            setPlugins(data.plugins || []);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to fetch plugins');
        } finally {
            setIsLoading(false);
        }
    };

    const handlePluginAction = async (action: 'install' | 'uninstall' | 'enable' | 'disable', pluginId: string) => {
        try {
            setIsLoading(true);
            setError(null);
            setSuccessMessage(null);

            const response = await fetch(`${runtimeConfig.apiBaseUrl}/plugin-management/${pluginId}/${action}`, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${token}`,
                    'Content-Type': 'application/json'
                }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `Failed to ${action} plugin`);
            }

            setSuccessMessage(data.message || `Plugin ${action}ed successfully`);

            // Refresh plugins list
            await fetchPlugins();

            // Clear success message after 3 seconds
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to ${action} plugin`);
        } finally {
            setIsLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            {error && (
                <div className={`${styles.alert} ${styles.alert_error}`}>
                    {error}
                </div>
            )}

            {successMessage && (
                <div className={`${styles.alert} ${styles.alert_success}`}>
                    {successMessage}
                </div>
            )}

            <div className={styles.stats_grid}>
                <div className={styles.stat_item}>
                    <div className={styles.stat_label}>Total Plugins</div>
                    <div className={styles.stat_value}>{plugins.length}</div>
                </div>
                <div className={styles.stat_item}>
                    <div className={styles.stat_label}>Installed</div>
                    <div className={`${styles.stat_value} ${styles.stat_value_success}`}>
                        {plugins.filter(p => p.metadata.installed).length}
                    </div>
                </div>
                <div className={styles.stat_item}>
                    <div className={styles.stat_label}>Enabled</div>
                    <div className={`${styles.stat_value} ${styles.stat_value_primary}`}>
                        {plugins.filter(p => p.metadata.enabled).length}
                    </div>
                </div>
                <div className={styles.stat_item}>
                    <div className={styles.stat_label}>Errors</div>
                    <div className={`${styles.stat_value} ${styles.stat_value_danger}`}>
                        {plugins.filter(p => p.metadata.lastError).length}
                    </div>
                </div>
            </div>

            <div className={styles.plugins_list}>
                {plugins.map(pluginInfo => (
                    <PluginCard
                        key={pluginInfo.manifest.id}
                        pluginInfo={pluginInfo}
                        onInstall={(id) => handlePluginAction('install', id)}
                        onUninstall={(id) => handlePluginAction('uninstall', id)}
                        onEnable={(id) => handlePluginAction('enable', id)}
                        onDisable={(id) => handlePluginAction('disable', id)}
                        isLoading={isLoading}
                    />
                ))}
            </div>

            {plugins.length === 0 && !isLoading && (
                <div className={styles.empty_state}>
                    No plugins found
                </div>
            )}
        </div>
    );
}
