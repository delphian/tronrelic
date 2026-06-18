'use client';

/**
 * @fileoverview Policy tab — per-tool governance overrides over the
 * capability-class defaults. Each row shows usage tallies and an editor for the
 * security-relevant knobs (approval, unattended, rate cap, cost ceiling).
 * Saving writes an override that the governor merges over the class defaults;
 * Clear reverts the tool to those defaults.
 */

import { useEffect, useState, useCallback } from 'react';
import type { IAiToolInfo, IToolPolicy } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Badge } from '../../../../../components/ui/Badge';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { listTools, getPolicy, setPolicy, clearPolicy, type IPolicyResponse } from '../../../../../modules/ai-tools';
import styles from '../page.module.scss';

/** Default rate window applied when an admin sets a per-tool rate cap (1 min). */
const RATE_WINDOW_MS = 60_000;

/** Usage tally shape from `GET /policy`. */
type Usage = IPolicyResponse['usage'][string];

/**
 * Tri-state for an optional boolean policy field. `inherit` leaves the field out
 * of the saved override so the governor keeps the capability-class default;
 * `on`/`off` force the value. Seeding from the override (undefined → `inherit`)
 * is what prevents a save from silently overwriting a class default an admin
 * never meant to touch.
 */
type TriState = 'inherit' | 'on' | 'off';

/**
 * Map an override field's stored value to its tri-state. An absent field
 * (`undefined`) means the override does not set it, so the class default
 * applies — `inherit`.
 *
 * @param value - The override field value, or undefined when unset.
 * @returns The matching tri-state.
 */
function triFrom(value: boolean | undefined): TriState {
    return value === undefined ? 'inherit' : value ? 'on' : 'off';
}

/**
 * Curation handling for a tool that routes effects through the central review
 * queue. `inherit` omits the field so the governor keeps the derived default
 * (`require`); `require`/`auto-approve` force it.
 */
type CurationMode = 'inherit' | 'require' | 'auto-approve';

/**
 * Map an override's curation value to the select state. Absent → `inherit`.
 *
 * @param value - The override's curation value, or undefined when unset.
 * @returns The matching select state.
 */
function curationFrom(value: IToolPolicy['curation'] | undefined): CurationMode {
    return value ?? 'inherit';
}

/**
 * Editable policy row for one tool. Local form state is seeded from the tool's
 * current override so each row edits independently.
 */
function PolicyRow({ tool, override, usage, onSaved }: {
    tool: IAiToolInfo;
    override?: IToolPolicy;
    usage?: Usage;
    onSaved: () => void;
}) {
    const [requireApproval, setRequireApproval] = useState<TriState>(triFrom(override?.requireApproval));
    const [allowUnattended, setAllowUnattended] = useState<TriState>(triFrom(override?.allowUnattended));
    const [rateMax, setRateMax] = useState<string>(override?.rateLimit ? String(override.rateLimit.max) : '');
    const [costCeiling, setCostCeiling] = useState<string>(override?.costCeilingUsd !== undefined ? String(override.costCeilingUsd) : '');
    const [curation, setCuration] = useState<CurationMode>(curationFrom(override?.curation));
    const [busy, setBusy] = useState(false);
    const { push } = useToast();

    const hasOverride = override !== undefined;
    // The curation control only bites on tools that route effects through the
    // central queue; others render a dash so the column isn't a live no-op.
    const curationCapable = tool.capability?.forcesCuratorReview === true;

    // Pending edits relative to the saved override. Save stays disabled until a
    // field actually changes, so a long tool list doesn't present a column of
    // live Save buttons inviting redundant no-op writes.
    const dirty =
        requireApproval !== triFrom(override?.requireApproval) ||
        allowUnattended !== triFrom(override?.allowUnattended) ||
        rateMax !== (override?.rateLimit ? String(override.rateLimit.max) : '') ||
        costCeiling !== (override?.costCeilingUsd !== undefined ? String(override.costCeilingUsd) : '') ||
        curation !== curationFrom(override?.curation);

    const save = useCallback(async () => {
        // Only write a tri-state field when the admin forced it. Leaving it out
        // lets the governor keep the capability-class default rather than pinning
        // (and possibly disabling) it — e.g. an unset approval gate stays on.
        const policy: IToolPolicy = {};
        if (requireApproval !== 'inherit') {
            policy.requireApproval = requireApproval === 'on';
        }
        if (allowUnattended !== 'inherit') {
            policy.allowUnattended = allowUnattended === 'on';
        }
        const parsedRate = Number(rateMax);
        if (rateMax.trim() !== '' && Number.isFinite(parsedRate) && parsedRate >= 0) {
            policy.rateLimit = { max: Math.floor(parsedRate), windowMs: RATE_WINDOW_MS };
        }
        const parsedCost = Number(costCeiling);
        if (costCeiling.trim() !== '' && Number.isFinite(parsedCost) && parsedCost >= 0) {
            policy.costCeilingUsd = parsedCost;
        }
        if (curation !== 'inherit') {
            policy.curation = curation;
        }
        setBusy(true);
        try {
            await setPolicy(tool.name, policy);
            push({ tone: 'success', title: `Override saved for ${tool.name}` });
            onSaved();
        } catch (err) {
            push({ tone: 'danger', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusy(false);
        }
    }, [requireApproval, allowUnattended, rateMax, costCeiling, curation, tool.name, push, onSaved]);

    const clear = useCallback(async () => {
        setBusy(true);
        try {
            await clearPolicy(tool.name);
            push({ tone: 'info', title: `Override cleared for ${tool.name}` });
            onSaved();
        } catch (err) {
            push({ tone: 'danger', title: 'Clear failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusy(false);
        }
    }, [tool.name, push, onSaved]);

    return (
        <Tr>
            <Td>
                <div className={styles.tool_cell}>
                    <span className={styles.tool_name}>{tool.name}</span>
                    {hasOverride && <Badge tone="info">override</Badge>}
                </div>
            </Td>
            <Td muted className={styles.usage_cell}>
                {usage ? `${usage.invocations} calls · ${usage.denied} denied · ${usage.needsApproval} held` : 'no activity'}
            </Td>
            <Td>
                <select
                    className={`${styles.filter_select} ${styles.cell_control}`}
                    value={requireApproval}
                    onChange={(e) => setRequireApproval(e.target.value as TriState)}
                    aria-label={`Require approval for ${tool.name}`}
                >
                    <option value="inherit">Default</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                </select>
            </Td>
            <Td>
                <select
                    className={`${styles.filter_select} ${styles.cell_control}`}
                    value={allowUnattended}
                    onChange={(e) => setAllowUnattended(e.target.value as TriState)}
                    aria-label={`Allow unattended runs for ${tool.name}`}
                >
                    <option value="inherit">Default</option>
                    <option value="on">On</option>
                    <option value="off">Off</option>
                </select>
            </Td>
            <Td>
                {curationCapable ? (
                    <select
                        className={`${styles.filter_select} ${styles.cell_control}`}
                        value={curation}
                        onChange={(e) => setCuration(e.target.value as CurationMode)}
                        aria-label={`Curation handling for ${tool.name}`}
                    >
                        <option value="inherit">Default</option>
                        <option value="require">Require</option>
                        <option value="auto-approve">Auto-approve</option>
                    </select>
                ) : (
                    <span className="text-subtle">—</span>
                )}
            </Td>
            <Td>
                <Input type="number" min={0} value={rateMax} onChange={(e) => setRateMax(e.target.value)} placeholder="default" aria-label={`Rate limit per minute for ${tool.name}`} className={styles.cell_control} />
            </Td>
            <Td>
                <Input type="number" min={0} step="0.01" value={costCeiling} onChange={(e) => setCostCeiling(e.target.value)} placeholder="none" aria-label={`Cost ceiling for ${tool.name}`} className={styles.cell_control} />
            </Td>
            <Td>
                <div className={styles.row_actions}>
                    <Button variant="primary" size="sm" loading={busy} disabled={busy || !dirty} onClick={() => { void save(); }}>Save</Button>
                    <Button variant="ghost" size="sm" disabled={busy || !hasOverride} onClick={() => { void clear(); }}>Clear</Button>
                </div>
            </Td>
        </Tr>
    );
}

/**
 * Policy tab content.
 *
 * @returns The tab.
 */
export function PolicyTab() {
    const [tools, setTools] = useState<IAiToolInfo[]>([]);
    const [policy, setPolicyState] = useState<IPolicyResponse>({ overrides: {}, usage: {} });
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const load = useCallback(async () => {
        try {
            const [t, p] = await Promise.all([listTools(), getPolicy()]);
            setTools(t);
            setPolicyState(p);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load policy');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    if (loading) {
        return <div className={styles.placeholder}>Loading policy…</div>;
    }

    return (
        <Stack gap="md">
            {error && <div className="alert" role="alert">{error}</div>}
            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                Overrides force these values over the capability-class defaults. Clear an override to revert a tool to its class defaults.
            </p>
            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                Both dropdowns are three-way: <strong>Default</strong> keeps the tool&apos;s capability-class
                default, while <strong>On</strong>/<strong>Off</strong> force it. <strong>Require approval</strong> On
                holds every call in the Approvals tab before it runs (by default only external, irreversible tools are
                held). <strong>Unattended</strong> sets whether the tool may run on autonomous paths — scheduled prompts
                and programmatic queries — where external tools are otherwise barred. <strong>Rate / min</strong> caps
                invocations per minute across all callers; blank inherits the class default (120 read, 60 write, 30
                external), under a 240/min global ceiling. <strong>Cost ceiling (USD)</strong> caps a paid tool&apos;s spend
                over a fixed 24-hour window — each call that runs is charged the tool&apos;s declared per-call cost, and
                further calls are denied once the ceiling would be exceeded; blank means no cap, and a tool that
                declares no per-call cost cannot be capped.
            </p>
            <p className="text-muted" style={{ margin: 0, fontSize: 'var(--font-size-body-sm)' }}>
                <strong>Curation</strong> applies only to tools that route effects through the central review queue.
                <strong> Require</strong> (the default) holds every effect for manual approval in the Curation tab;
                <strong> Auto-approve</strong> is an explicit, audited bypass that releases held effects without review —
                honoured <strong>only on interactive admin queries</strong>, never on scheduled or programmatic runs, and it
                re-arms the lethal-trifecta banner for that tool. Tools that don&apos;t self-curate show “—”.
            </p>
            <div className="table-scroll">
                <Table>
                    <Thead>
                        <Tr>
                            <Th width="expand">Tool</Th>
                            <Th width="shrink">Usage</Th>
                            <Th>Require approval</Th>
                            <Th>Unattended</Th>
                            <Th>Curation</Th>
                            <Th>Rate / min</Th>
                            <Th>Cost ceiling (USD)</Th>
                            <Th width="shrink">Actions</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {tools.map(tool => (
                            <PolicyRow
                                key={tool.name}
                                tool={tool}
                                override={policy.overrides[tool.name]}
                                usage={policy.usage[tool.name]}
                                onSaved={load}
                            />
                        ))}
                    </Tbody>
                </Table>
            </div>
        </Stack>
    );
}
