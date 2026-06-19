'use client';

/**
 * @fileoverview Registry tab — every registered tool with provider attribution,
 * capability badges, and an enable toggle, plus the Provider panel. Each tool
 * row expands to an inline policy editor (the former standalone Policy tab now
 * lives here, one editor per tool), and an "only overrides" filter turns the
 * list into a deviation inventory. Toggling a tool or saving a policy override
 * re-checks the trifecta via the `onChanged` callback the page owns — both can
 * form or break it.
 */

import { useEffect, useState, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import type { IAiToolInfo, IAiProviderInfo } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Table, Thead, Tbody, Tr, Th } from '../../../../../components/ui/Table';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { listTools, listProviders, setToolEnabled, getPolicy, type IPolicyResponse } from '../../../../../modules/ai-tools';
import { ProviderPanel } from '../components/ProviderPanel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { RegistryToolRow } from '../components/RegistryToolRow';
import { VariablesSection } from './VariablesSection';
import { SystemPromptsSection } from './SystemPromptsSection';
import styles from '../page.module.scss';

/** Total column count of the Tools table — used so an expanded editor cell spans it. */
const TOOL_COLUMN_COUNT = 5;

/**
 * Registry tab content.
 *
 * @param props.onChanged - Called after an enable toggle or a policy save/clear so
 *                          the page can refresh the trifecta banner (either can
 *                          form or break it).
 * @returns The tab.
 */
export function RegistryTab({ onChanged }: { onChanged: () => void }) {
    const [tools, setTools] = useState<IAiToolInfo[]>([]);
    const [providers, setProviders] = useState<IAiProviderInfo[]>([]);
    const [policy, setPolicyState] = useState<IPolicyResponse>({ overrides: {}, usage: {}, defaults: {} });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyName, setBusyName] = useState<string | null>(null);
    const [onlyOverrides, setOnlyOverrides] = useState(false);
    const { push } = useToast();

    const load = useCallback(async () => {
        try {
            const [t, p, pol] = await Promise.all([listTools(), listProviders(), getPolicy()]);
            setTools(t);
            setProviders(p);
            setPolicyState(pol);
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

    // A saved or cleared override can re-arm or quiet the trifecta (curation
    // auto-approve un-gates egress), so reload policy and re-check the banner.
    const handlePolicyChanged = useCallback(async () => {
        await load();
        onChanged();
    }, [load, onChanged]);

    if (loading) {
        return <div className={styles.placeholder}>Loading tools…</div>;
    }

    const overrideCount = tools.filter(tool => policy.overrides[tool.name] !== undefined).length;
    const disabledCount = tools.filter(tool => !tool.enabled).length;
    const toolsSummary = `${tools.length} tools · ${disabledCount} disabled · ${overrideCount} overrides`;
    const visibleTools = onlyOverrides
        ? tools.filter(tool => policy.overrides[tool.name] !== undefined)
        : tools;

    return (
        <Stack gap="md">
            <ProviderPanel providers={providers} />
            {error && (
                <div className="alert" role="alert">
                    <AlertCircle size={16} style={{ color: 'var(--color-danger)', verticalAlign: 'text-bottom' }} /> {error}
                </div>
            )}
            <CollapsibleSection title="Tools" summary={toolsSummary}>
                {tools.length === 0
                    ? <div className={styles.placeholder}>No tools are registered.</div>
                    : (
                        <Stack gap="sm">
                            <label className={styles.check_label}>
                                <input
                                    type="checkbox"
                                    checked={onlyOverrides}
                                    onChange={(e) => setOnlyOverrides(e.target.checked)}
                                />
                                Only show tools with a policy override
                            </label>
                            {visibleTools.length === 0
                                ? <div className={styles.placeholder}>No tools have a policy override.</div>
                                : (
                                    <div className="table-scroll">
                                        <Table>
                                            <Thead>
                                                <Tr>
                                                    <Th width="shrink" aria-label="Expand policy" />
                                                    <Th>Tool</Th>
                                                    <Th width="shrink">Provider</Th>
                                                    <Th>Capability</Th>
                                                    <Th width="shrink">Enabled</Th>
                                                </Tr>
                                            </Thead>
                                            <Tbody>
                                                {visibleTools.map(tool => (
                                                    <RegistryToolRow
                                                        key={tool.name}
                                                        tool={tool}
                                                        override={policy.overrides[tool.name]}
                                                        usage={policy.usage[tool.name]}
                                                        defaults={policy.defaults[tool.name]}
                                                        busy={busyName === tool.name}
                                                        columnCount={TOOL_COLUMN_COUNT}
                                                        onToggle={handleToggle}
                                                        onPolicyChanged={handlePolicyChanged}
                                                    />
                                                ))}
                                            </Tbody>
                                        </Table>
                                    </div>
                                )}
                        </Stack>
                    )}
            </CollapsibleSection>
            <VariablesSection onChanged={onChanged} />
            <SystemPromptsSection />
        </Stack>
    );
}
