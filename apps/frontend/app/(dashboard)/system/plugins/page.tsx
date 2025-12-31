'use client';

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronRight, Download, Trash2, Settings, AlertCircle } from 'lucide-react';
import { config as runtimeConfig } from '../../../../lib/config';
import { useSystemAuth } from '../../../../features/system';
import { Page, Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import type { IPluginInfo } from '@tronrelic/types';
import styles from './PluginsManagementPage.module.scss';

/**
 * Toggle switch component for boolean state changes.
 *
 * Displays a sliding toggle control with loading state feedback.
 * Used for enable/disable plugin actions without confirmation dialogs.
 *
 * @param props - Component props
 * @param props.enabled - Current toggle state
 * @param props.onChange - Callback when toggle is clicked
 * @param props.disabled - Whether the toggle is interactive
 * @param props.loading - Whether an operation is in progress
 */
function Toggle({ enabled, onChange, disabled, loading }: {
    enabled: boolean;
    onChange: () => void;
    disabled?: boolean;
    loading?: boolean;
}) {
    return (
        <button
            type="button"
            role="switch"
            aria-checked={enabled}
            onClick={onChange}
            disabled={disabled || loading}
            className={`${styles.toggle} ${enabled ? styles.toggle_on : styles.toggle_off} ${loading ? styles.toggle_loading : ''}`}
        >
            <span className={styles.toggle_thumb} />
        </button>
    );
}

/**
 * Plugin row component for the management table.
 *
 * Displays plugin metadata in a compact row with expandable details section.
 * Provides direct action buttons for install, uninstall, and settings access.
 * Enable/disable uses a toggle switch for immediate feedback.
 *
 * @param props - Component props
 * @param props.pluginInfo - Plugin manifest and runtime metadata
 * @param props.onInstall - Callback when install is requested
 * @param props.onUninstall - Callback when uninstall is requested
 * @param props.onToggleEnabled - Callback when enable/disable toggle changes
 * @param props.isLoading - Whether any operation is in progress
 * @param props.loadingPluginId - The specific plugin ID being operated on
 */
function PluginRow({ pluginInfo, onInstall, onUninstall, onToggleEnabled, isLoading, loadingPluginId }: {
    pluginInfo: IPluginInfo;
    onInstall: (pluginId: string) => void;
    onUninstall: (pluginId: string) => void;
    onToggleEnabled: (pluginId: string, enable: boolean) => void;
    isLoading: boolean;
    loadingPluginId: string | null;
}) {
    const { manifest, metadata } = pluginInfo;
    const [expanded, setExpanded] = useState(false);
    const isThisLoading = loadingPluginId === manifest.id;

    return (
        <>
            <Tr hasError={!!metadata.lastError}>
                <Td className={styles.cell_expand}>
                    <button
                        type="button"
                        onClick={() => setExpanded(!expanded)}
                        className={styles.expand_btn}
                        aria-expanded={expanded}
                        aria-label={expanded ? 'Collapse details' : 'Expand details'}
                    >
                        {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    </button>
                </Td>
                <Td>
                    <div className={styles.plugin_name}>
                        {manifest.title}
                        {metadata.lastError && (
                            <AlertCircle size={14} className={styles.error_icon} />
                        )}
                    </div>
                    <div className={styles.plugin_id}>{manifest.id}</div>
                </Td>
                <Td muted className={styles.cell_version}>
                    v{manifest.version}
                </Td>
                <Td className={styles.cell_status}>
                    {metadata.installed ? (
                        <Badge tone="success">Installed</Badge>
                    ) : (
                        <Badge tone="neutral">Available</Badge>
                    )}
                </Td>
                <Td className={styles.cell_enabled}>
                    {metadata.installed && (
                        <Toggle
                            enabled={metadata.enabled}
                            onChange={() => onToggleEnabled(manifest.id, !metadata.enabled)}
                            disabled={isLoading}
                            loading={isThisLoading}
                        />
                    )}
                </Td>
                <Td className={styles.cell_actions}>
                    <div className={styles.action_buttons}>
                        {!metadata.installed ? (
                            <Button
                                variant="primary"
                                size="sm"
                                icon={<Download size={14} />}
                                onClick={() => onInstall(manifest.id)}
                                disabled={isLoading}
                                loading={isThisLoading}
                            >
                                Install
                            </Button>
                        ) : (
                            <>
                                {manifest.adminUrl && (
                                    <a
                                        href={manifest.adminUrl}
                                        className={styles.settings_link}
                                        title="Plugin settings"
                                    >
                                        <Settings size={16} />
                                    </a>
                                )}
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<Trash2 size={14} />}
                                    onClick={() => onUninstall(manifest.id)}
                                    disabled={isLoading}
                                    loading={isThisLoading}
                                    title="Uninstall plugin"
                                />
                            </>
                        )}
                    </div>
                </Td>
            </Tr>
            {expanded && (
                <Tr isExpanded>
                    <Td colSpan={6}>
                        <div className={styles.details_content}>
                            {manifest.description && (
                                <p className={styles.description}>{manifest.description}</p>
                            )}
                            <div className={styles.details_grid}>
                                {manifest.author && (
                                    <div className={styles.detail_item}>
                                        <span className={styles.detail_label}>Author</span>
                                        <span className={styles.detail_value}>{manifest.author}</span>
                                    </div>
                                )}
                                {manifest.license && (
                                    <div className={styles.detail_item}>
                                        <span className={styles.detail_label}>License</span>
                                        <span className={styles.detail_value}>{manifest.license}</span>
                                    </div>
                                )}
                                <div className={styles.detail_item}>
                                    <span className={styles.detail_label}>Backend</span>
                                    <span className={styles.detail_value}>{manifest.backend ? 'Yes' : 'No'}</span>
                                </div>
                                <div className={styles.detail_item}>
                                    <span className={styles.detail_label}>Frontend</span>
                                    <span className={styles.detail_value}>{manifest.frontend ? 'Yes' : 'No'}</span>
                                </div>
                            </div>
                            {metadata.lastError && (
                                <div className={styles.error_block}>
                                    <div className={styles.error_header}>
                                        <AlertCircle size={14} />
                                        <span>Error</span>
                                        {metadata.lastErrorAt && (
                                            <span className={styles.error_time}>
                                                {new Date(metadata.lastErrorAt).toLocaleString()}
                                            </span>
                                        )}
                                    </div>
                                    <p className={styles.error_message}>{metadata.lastError}</p>
                                </div>
                            )}
                        </div>
                    </Td>
                </Tr>
            )}
        </>
    );
}

/**
 * Plugin management page.
 *
 * Displays all discovered plugins in a compact table format with inline controls.
 * Provides aggregate statistics, direct action buttons without confirmation dialogs,
 * and expandable rows for detailed plugin information.
 * Requires admin authentication via shared SystemAuth context.
 */
export default function PluginsManagementPage() {
    const { token } = useSystemAuth();
    const [plugins, setPlugins] = useState<IPluginInfo[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [loadingPluginId, setLoadingPluginId] = useState<string | null>(null);
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
            setLoadingPluginId(pluginId);
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
            await fetchPlugins();
            setTimeout(() => setSuccessMessage(null), 3000);
        } catch (err) {
            setError(err instanceof Error ? err.message : `Failed to ${action} plugin`);
        } finally {
            setLoadingPluginId(null);
        }
    };

    const installed = plugins.filter(p => p.metadata.installed).length;
    const enabled = plugins.filter(p => p.metadata.enabled).length;
    const withErrors = plugins.filter(p => p.metadata.lastError).length;

    return (
        <Page>
            <Stack gap="md">
                {error && (
                    <div className={styles.alert_error}>
                        <AlertCircle size={16} />
                        {error}
                    </div>
                )}

                {successMessage && (
                    <div className={styles.alert_success}>
                        {successMessage}
                    </div>
                )}

                <div className={styles.stats_bar}>
                    <div className={styles.stat}>
                        <span className={styles.stat_value}>{plugins.length}</span>
                        <span className={styles.stat_label}>Total</span>
                    </div>
                    <div className={styles.stat_divider} />
                    <div className={styles.stat}>
                        <span className={`${styles.stat_value} ${styles.stat_success}`}>{installed}</span>
                        <span className={styles.stat_label}>Installed</span>
                    </div>
                    <div className={styles.stat_divider} />
                    <div className={styles.stat}>
                        <span className={`${styles.stat_value} ${styles.stat_primary}`}>{enabled}</span>
                        <span className={styles.stat_label}>Enabled</span>
                    </div>
                    {withErrors > 0 && (
                        <>
                            <div className={styles.stat_divider} />
                            <div className={styles.stat}>
                                <span className={`${styles.stat_value} ${styles.stat_danger}`}>{withErrors}</span>
                                <span className={styles.stat_label}>Errors</span>
                            </div>
                        </>
                    )}
                </div>

                {plugins.length === 0 && !isLoading ? (
                    <div className={styles.empty_state}>
                        No plugins found
                    </div>
                ) : (
                    <Table>
                        <Thead>
                            <Tr>
                                <Th width="shrink"></Th>
                                <Th>Plugin</Th>
                                <Th width="shrink">Version</Th>
                                <Th width="shrink">Status</Th>
                                <Th width="shrink" className={styles.th_enabled}>Enabled</Th>
                                <Th width="shrink">Actions</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {plugins.map(pluginInfo => (
                                <PluginRow
                                    key={pluginInfo.manifest.id}
                                    pluginInfo={pluginInfo}
                                    onInstall={(id) => handlePluginAction('install', id)}
                                    onUninstall={(id) => handlePluginAction('uninstall', id)}
                                    onToggleEnabled={(id, enable) => handlePluginAction(enable ? 'enable' : 'disable', id)}
                                    isLoading={!!loadingPluginId}
                                    loadingPluginId={loadingPluginId}
                                />
                            ))}
                        </Tbody>
                    </Table>
                )}
            </Stack>
        </Page>
    );
}
