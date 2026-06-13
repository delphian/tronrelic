'use client';

/**
 * @fileoverview Registry tab — every registered tool with provider attribution,
 * capability badges, and an enable toggle, plus the Provider panel. Toggling a
 * tool re-checks the trifecta via the `onChanged` callback the page owns.
 */

import { useEffect, useState, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import type { IAiToolInfo, IAiProviderInfo } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Switch } from '../../../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { listTools, setToolEnabled, listProviders } from '../../../../../modules/ai-tools';
import { CapabilityBadges } from '../components/CapabilityBadges';
import { ProviderPanel } from '../components/ProviderPanel';
import styles from '../page.module.scss';

/**
 * Registry tab content.
 *
 * @param props.onChanged - Called after an enable toggle so the page can refresh
 *                          the trifecta banner (enabling a tool can form it).
 * @returns The tab.
 */
export function RegistryTab({ onChanged }: { onChanged: () => void }) {
    const [tools, setTools] = useState<IAiToolInfo[]>([]);
    const [providers, setProviders] = useState<IAiProviderInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyName, setBusyName] = useState<string | null>(null);
    const { push } = useToast();

    const load = useCallback(async () => {
        try {
            const [t, p] = await Promise.all([listTools(), listProviders()]);
            setTools(t);
            setProviders(p);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load tools');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const handleToggle = useCallback(async (name: string, enabled: boolean) => {
        setBusyName(name);
        try {
            await setToolEnabled(name, enabled);
            await load();
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Toggle failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusyName(null);
        }
    }, [load, onChanged, push]);

    if (loading) {
        return <div className={styles.placeholder}>Loading tools…</div>;
    }

    return (
        <Stack gap="md">
            <ProviderPanel providers={providers} />
            {error && (
                <div className="alert" role="alert">
                    <AlertCircle size={16} style={{ color: 'var(--color-danger)', verticalAlign: 'text-bottom' }} /> {error}
                </div>
            )}
            {tools.length === 0
                ? <div className={styles.placeholder}>No tools are registered.</div>
                : (
                    <div className="table-scroll">
                        <Table>
                            <Thead>
                                <Tr>
                                    <Th>Tool</Th>
                                    <Th width="shrink">Provider</Th>
                                    <Th>Capability</Th>
                                    <Th width="shrink">Enabled</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {tools.map(tool => (
                                    <Tr key={tool.name}>
                                        <Td>
                                            <div className={styles.tool_name}>{tool.name}</div>
                                            <div className={styles.tool_desc}>{tool.description}</div>
                                        </Td>
                                        <Td muted>{tool.provider}</Td>
                                        <Td><CapabilityBadges capability={tool.capability} /></Td>
                                        <Td>
                                            <Switch
                                                on={tool.enabled}
                                                onChange={(next) => handleToggle(tool.name, next)}
                                                disabled={busyName === tool.name}
                                                aria-label={`${tool.enabled ? 'Disable' : 'Enable'} ${tool.name}`}
                                            />
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    </div>
                )}
        </Stack>
    );
}
