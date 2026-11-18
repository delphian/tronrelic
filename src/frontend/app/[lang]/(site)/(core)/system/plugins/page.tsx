'use client';

/**
 * @fileoverview /system/plugins: every discovered plugin, its lifecycle state,
 * and the controls that install, enable, disable, and uninstall it.
 *
 * The page opens on a compact header whose subtitle carries the counts, so the
 * figures cost no height of their own. Each row reads as two lines: the
 * plugin's title, then its id and version followed by its description, or by
 * the first line of its last error when a lifecycle hook failed, so the reason
 * for a failure shows without opening the row. Almost every plugin is
 * installed, so there is no status column: only a plugin that is not
 * installed is marked, with a badge beside its title.
 *
 * The page fetches after mounting because it is an admin surface authorized by
 * the session cookie, like the other single-registry admin pages.
 */

import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight, Download, Trash2, Settings, AlertCircle } from 'lucide-react';
import type { IPluginInfo } from '@/types';
import { AdminPage } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { Button } from '../../../../../../components/ui/Button';
import { Switch } from '../../../../../../components/ui/Switch';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { SiteLink } from '../../../../../../components/ui/SiteLink';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import { useLocalizedHref } from '../../../../../../modules/localization';
import styles from './PluginsManagementPage.module.scss';

/** The lifecycle actions the management routes accept. */
type PluginAction = 'install' | 'uninstall' | 'enable' | 'disable';

/** Columns every row has: Plugin, Enabled, and Actions. The details row spans them all. */
const COLUMN_COUNT = 3;

/** The first line of a stored error, which is all a row has room for. */
function firstLine(text: string): string {
    return text.split('\n')[0].trim();
}

/** Props for one plugin's row and the details row it opens. */
interface IPluginRowProps {
    /** The plugin's manifest and stored lifecycle state. */
    pluginInfo: IPluginInfo;
    /** Starts an install of the plugin. */
    onInstall: (pluginId: string) => void;
    /** Starts an uninstall of the plugin. */
    onUninstall: (pluginId: string) => void;
    /** Switches the plugin on or off. */
    onToggleEnabled: (pluginId: string, enable: boolean) => void;
    /** True while any lifecycle action is in flight, which disables every row's controls. */
    isLoading: boolean;
    /** The plugin whose action is in flight, if any. */
    loadingPluginId: string | null;
}

/**
 * One plugin as a table row, plus the details row it opens.
 *
 * The plugin cell holds the expand toggle, the title, and the id, version,
 * and description or error line, so the row needs no Version or Status
 * column. The Enabled and Actions cells carry no `label`: when the table
 * stacks on a phone they share the entry's first line with the plugin
 * instead of each taking a labelled line of its own.
 *
 * @param props - The plugin and the page's callbacks, as described on IPluginRowProps.
 * @returns The plugin's row and, when expanded, its details row.
 */
function PluginRow({ pluginInfo, onInstall, onUninstall, onToggleEnabled, isLoading, loadingPluginId }: IPluginRowProps) {
    const { manifest, metadata } = pluginInfo;
    const [expanded, setExpanded] = useState(false);
    const localize = useLocalizedHref();
    const isThisLoading = loadingPluginId === manifest.id;
    const errorLine = metadata.lastError ? firstLine(metadata.lastError) : null;
    const summary = errorLine ?? manifest.description ?? null;

    return (
        <>
            <Tr hasError={!!metadata.lastError}>
                <Td>
                    <div className={styles.plugin_cell}>
                        <button
                            type="button"
                            onClick={() => setExpanded(!expanded)}
                            className={styles.expand_btn}
                            aria-expanded={expanded}
                            aria-label={expanded ? `Collapse details for ${manifest.title}` : `Expand details for ${manifest.title}`}
                        >
                            {expanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                        </button>
                        <div className={styles.plugin_title}>
                            <span className={styles.plugin_name}>{manifest.title}</span>
                            {/* Decorative: the error itself is the line below. */}
                            {metadata.lastError && <AlertCircle size={14} className={styles.error_icon} aria-hidden />}
                            {!metadata.installed && <Badge tone="neutral" size="xs">Available</Badge>}
                        </div>
                        <div className={styles.plugin_meta}>
                            <span className={styles.plugin_id}>{`${manifest.id} · v${manifest.version}`}</span>
                            {summary && (
                                <span
                                    className={errorLine ? styles.plugin_error : styles.plugin_description}
                                    title={summary}
                                >
                                    {summary}
                                </span>
                            )}
                        </div>
                    </div>
                </Td>
                <Td className={styles.cell_enabled}>
                    {metadata.installed && (
                        <Switch
                            on={metadata.enabled}
                            onChange={(next) => onToggleEnabled(manifest.id, next)}
                            disabled={isLoading || isThisLoading}
                            aria-label={`${metadata.enabled ? 'Disable' : 'Enable'} ${manifest.title}`}
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
                                {/* The slot is drawn on every installed row, empty
                                    when the plugin has no settings page, so the
                                    uninstall buttons line up down the column. */}
                                <span className={styles.settings_slot}>
                                    {manifest.adminUrl && (
                                        <SiteLink
                                            href={localize(manifest.adminUrl)}
                                            className={styles.settings_link}
                                            title="Plugin settings"
                                            aria-label={`Settings for ${manifest.title}`}
                                        >
                                            <Settings size={16} aria-hidden />
                                        </SiteLink>
                                    )}
                                </span>
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    icon={<Trash2 size={14} />}
                                    onClick={() => onUninstall(manifest.id)}
                                    disabled={isLoading}
                                    loading={isThisLoading}
                                    title="Uninstall plugin"
                                    aria-label={`Uninstall ${manifest.title}`}
                                />
                            </>
                        )}
                    </div>
                </Td>
            </Tr>
            {expanded && (
                <Tr isExpanded>
                    <Td colSpan={COLUMN_COUNT}>
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
                                                <ClientTime date={metadata.lastErrorAt} format="datetime" />
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
 * The header's subtitle: how many plugins were discovered, installed, and
 * enabled, and how many last failed, the last in danger text so a failure is
 * noticed before the table is scanned.
 *
 * @param plugins - Every discovered plugin.
 * @param isLoading - Whether the list is still loading, so the line does not
 *        read "0 plugins" before the first response.
 * @returns The subtitle content.
 */
function countsSubtitle(plugins: IPluginInfo[], isLoading: boolean): ReactNode {
    const installed = plugins.filter(p => p.metadata.installed).length;
    const enabled = plugins.filter(p => p.metadata.enabled).length;
    const withErrors = plugins.filter(p => p.metadata.lastError).length;
    let subtitle: ReactNode = `${plugins.length} ${plugins.length === 1 ? 'plugin' : 'plugins'} · ${installed} installed · ${enabled} enabled`;

    if (isLoading && plugins.length === 0) {
        subtitle = 'Loading plugins…';
    } else if (withErrors > 0) {
        subtitle = (
            <>
                {subtitle}
                {' · '}
                <span className={styles.subtitle_danger}>{withErrors} with errors</span>
            </>
        );
    }

    return subtitle;
}

/**
 * Plugin management page.
 *
 * Lists every discovered plugin in one table with inline controls, acting on
 * a click without a confirmation dialog. The result of an action is reported
 * in a toast rather than in an alert above the table, because an alert there
 * pushes every row down for as long as it shows. A failure to load the list itself stays
 * inline, because there is then no table to act on.
 *
 * @returns The page.
 */
export default function PluginsManagementPage() {
    const [plugins, setPlugins] = useState<IPluginInfo[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [loadingPluginId, setLoadingPluginId] = useState<string | null>(null);
    const [loadError, setLoadError] = useState<string | null>(null);
    const { push } = useToast();

    /**
     * Read every discovered plugin with its stored state, on mount and after
     * each lifecycle action, so the table shows what the backend now holds.
     */
    const fetchPlugins = useCallback(async (): Promise<void> => {
        try {
            setIsLoading(true);
            setLoadError(null);
            const response = await fetch(`/api/plugin-management/all`);

            if (!response.ok) {
                throw new Error('Failed to fetch plugins');
            }

            const data = await response.json();
            setPlugins(data.plugins || []);
        } catch (err) {
            setLoadError(err instanceof Error ? err.message : 'Failed to fetch plugins');
        } finally {
            setIsLoading(false);
        }
    }, []);

    /** Loads the list once the page mounts. */
    useEffect(() => {
        void fetchPlugins();
    }, [fetchPlugins]);

    /**
     * Run one lifecycle action, report its result in a toast, and re-read the
     * list so the row shows the plugin's new state.
     *
     * @param action - The lifecycle step the operator asked for.
     * @param pluginId - The plugin to act on.
     */
    const handlePluginAction = async (action: PluginAction, pluginId: string): Promise<void> => {
        try {
            setLoadingPluginId(pluginId);

            const response = await fetch(`/api/plugin-management/${pluginId}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.error || `Failed to ${action} plugin`);
            }

            push({ tone: 'success', title: data.message || `Plugin ${action}ed successfully` });
            await fetchPlugins();
        } catch (err) {
            push({ tone: 'danger', title: `Could not ${action} ${pluginId}`, description: err instanceof Error ? err.message : undefined });
        } finally {
            setLoadingPluginId(null);
        }
    };

    // Nothing under the header until the first response: the subtitle already
    // says the list is loading, and an empty table would show only its header.
    let body: ReactNode = null;
    if (loadError) {
        body = (
            <div className={styles.alert_error} role="alert">
                <AlertCircle size={16} aria-hidden />
                {loadError}
            </div>
        );
    } else if (plugins.length === 0 && !isLoading) {
        body = <div className={styles.empty_state}>No plugins found</div>;
    } else if (plugins.length > 0) {
        body = (
            /* Stacks on a phone. No cell carries a label, so each plugin
               becomes one entry with its switch and buttons beside it. */
            <Table stackAt="mobile">
                <Thead>
                    <Tr>
                        <Th width="expand">Plugin</Th>
                        <Th width="shrink" className={styles.th_enabled}>Enabled</Th>
                        <Th width="shrink" className={styles.th_actions}>Actions</Th>
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
        );
    }

    return (
        <AdminPage title="Plugins" subtitle={countsSubtitle(plugins, isLoading)}>
            {body}
        </AdminPage>
    );
}
