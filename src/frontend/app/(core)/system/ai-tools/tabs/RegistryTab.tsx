'use client';

/**
 * @fileoverview Registry tab — every registered tool with provider attribution,
 * a single dominant risk chip, and an enable toggle, plus the Provider panel.
 * The list is built for triage: risk and enabled-state lead, a search box and
 * per-class risk filters narrow it, and the default sort keeps enabled tools at
 * the top (disabled tools sink to the bottom) with the most dangerous tools
 * first within each group. Clicking a row opens a right slide-over holding the
 * full model-facing description, the input schema, and the per-tool policy
 * editor — the heavy surfaces that used to bloat each row. Toggling a tool or
 * saving a policy override re-checks the trifecta via the `onChanged` callback
 * the page owns, since both can form or break it.
 */

import { useEffect, useState, useCallback } from 'react';
import { AlertCircle } from 'lucide-react';
import type { IAiToolInfo, IAiProviderInfo } from '@/types';
import { cn } from '../../../../../lib/cn';
import { Stack } from '../../../../../components/layout';
import { Table, Thead, Tbody, Tr, Th } from '../../../../../components/ui/Table';
import { Input } from '../../../../../components/ui/Input';
import { SlideOver } from '../../../../../components/ui/SlideOver';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { listTools, listProviders, setToolEnabled, getPolicy, type IPolicyResponse } from '../../../../../modules/ai-tools';
import { ProviderPanel } from '../components/ProviderPanel';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { RegistryToolRow } from '../components/RegistryToolRow';
import { ToolDetailPanel } from '../components/ToolDetailPanel';
import {
    RISK_CLASS_ORDER,
    RISK_PRESENTATION,
    riskClassOf,
    riskRankOf,
    type RiskClass
} from '../components/RiskChip';
import { VariablesSection } from './VariablesSection';
import { SystemPromptsSection } from './SystemPromptsSection';
import { ScreenSettingsSection } from './ScreenSettingsSection';
import styles from '../page.module.scss';

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
    const [search, setSearch] = useState('');
    const [riskFilter, setRiskFilter] = useState<Set<RiskClass>>(new Set());
    const [selectedName, setSelectedName] = useState<string | null>(null);
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

    /**
     * Toggle a risk class in/out of the filter set. An empty set means no
     * filter (every class shows).
     *
     * @param riskClass - The class whose membership is flipped.
     */
    const toggleRisk = useCallback((riskClass: RiskClass) => {
        setRiskFilter(previous => {
            const next = new Set(previous);
            if (next.has(riskClass)) {
                next.delete(riskClass);
            } else {
                next.add(riskClass);
            }
            return next;
        });
    }, []);

    if (loading) {
        return <div className={styles.placeholder}>Loading tools…</div>;
    }

    const overrideCount = tools.filter(tool => policy.overrides[tool.name] !== undefined).length;
    const disabledCount = tools.filter(tool => !tool.enabled).length;
    const toolsSummary = `${tools.length} tools · ${disabledCount} disabled · ${overrideCount} overrides`;

    // Apply the three filters, then sort: enabled tools first so the live set
    // an operator acts on stays together at the top and disabled tools sink to
    // the bottom; within each group, dangerous-first (then by name) so an audit
    // sweep still meets the high-stakes tools at the top of the active list.
    const query = search.trim().toLowerCase();
    const visibleTools = tools
        .filter(tool => !onlyOverrides || policy.overrides[tool.name] !== undefined)
        .filter(tool => riskFilter.size === 0 || riskFilter.has(riskClassOf(tool.capability)))
        .filter(tool => query === ''
            || tool.name.toLowerCase().includes(query)
            || tool.description.toLowerCase().includes(query)
            || tool.provider.toLowerCase().includes(query))
        .sort((a, b) => {
            if (a.enabled !== b.enabled) {
                return a.enabled ? -1 : 1;
            }
            const byRisk = riskRankOf(b.capability) - riskRankOf(a.capability);
            return byRisk !== 0 ? byRisk : a.name.localeCompare(b.name);
        });

    // Derive the open tool from the live list so a reload (after toggle/policy
    // edit) flows fresh data into the panel rather than freezing a stale copy.
    const selectedTool = selectedName ? tools.find(tool => tool.name === selectedName) ?? null : null;

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
                            <div className={styles.filters}>
                                <Input
                                    className={styles.search_input}
                                    type="search"
                                    placeholder="Search tools…"
                                    aria-label="Search tools"
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                />
                                <div className={styles.risk_filters} role="group" aria-label="Filter by risk class">
                                    {RISK_CLASS_ORDER.map(riskClass => (
                                        <button
                                            key={riskClass}
                                            type="button"
                                            aria-pressed={riskFilter.has(riskClass)}
                                            className={cn(styles.risk_filter, riskFilter.has(riskClass) && styles['risk_filter--active'])}
                                            onClick={() => toggleRisk(riskClass)}
                                        >
                                            {RISK_PRESENTATION[riskClass].label}
                                        </button>
                                    ))}
                                </div>
                                <label className={styles.check_label}>
                                    <input
                                        type="checkbox"
                                        checked={onlyOverrides}
                                        onChange={(e) => setOnlyOverrides(e.target.checked)}
                                    />
                                    Only overrides
                                </label>
                            </div>
                            {visibleTools.length === 0
                                ? <div className={styles.placeholder}>No tools match the current filters.</div>
                                : (
                                    <div className="table-scroll">
                                        <Table>
                                            <Thead>
                                                <Tr>
                                                    <Th width="shrink">Enabled</Th>
                                                    <Th width="shrink">Risk</Th>
                                                    <Th>Tool</Th>
                                                    <Th width="expand">Description</Th>
                                                    <Th width="shrink">Provider</Th>
                                                </Tr>
                                            </Thead>
                                            <Tbody>
                                                {visibleTools.map(tool => (
                                                    <RegistryToolRow
                                                        key={tool.name}
                                                        tool={tool}
                                                        hasOverride={policy.overrides[tool.name] !== undefined}
                                                        busy={busyName === tool.name}
                                                        onToggle={handleToggle}
                                                        onSelect={(selected) => setSelectedName(selected.name)}
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
            <ScreenSettingsSection />

            <SlideOver
                open={selectedTool !== null}
                onClose={() => setSelectedName(null)}
                label={selectedTool ? `Tool ${selectedTool.name}` : undefined}
                title={selectedTool ? <span className={styles.tool_name}>{selectedTool.name}</span> : null}
            >
                {selectedTool && (
                    <ToolDetailPanel
                        tool={selectedTool}
                        override={policy.overrides[selectedTool.name]}
                        usage={policy.usage[selectedTool.name]}
                        defaults={policy.defaults[selectedTool.name]}
                        busy={busyName === selectedTool.name}
                        onToggle={handleToggle}
                        onPolicyChanged={handlePolicyChanged}
                    />
                )}
            </SlideOver>
        </Stack>
    );
}
