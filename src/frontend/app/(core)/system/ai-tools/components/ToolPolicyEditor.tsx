'use client';

/**
 * @fileoverview Per-tool policy editor — the security-relevant governance knobs
 * (approval, unattended runs, curation mode, rate cap, cost ceiling) for one AI
 * tool, rendered as a labelled form inside its Registry row's expander rather
 * than as a dense row in a separate Policy tab.
 *
 * Why here: the capability class shown on the Registry row is what *derives*
 * these defaults, so editing the override beside it keeps one surface for both
 * "what the tool is" and "how it is governed". Why an expander and not inline
 * columns: these knobs relax safety defaults — auto-approve re-arms the lethal
 * trifecta, allow-unattended defeats the autonomous default-deny — so they stay
 * one deliberate click away from the everyday enable toggle instead of sitting
 * adjacent to it where a mis-click is cheap. Saving writes an override the
 * governor merges over the capability-class defaults; Clear reverts the tool to
 * those defaults.
 */

import { useState, useCallback, useEffect } from 'react';
import { Save, RotateCcw } from 'lucide-react';
import type { IAiToolInfo, IToolPolicy } from '@/types';
import { Input } from '../../../../../components/ui/Input';
import { Select } from '../../../../../components/ui/Select';
import { Button } from '../../../../../components/ui/Button';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { setPolicy, clearPolicy, type IPolicyResponse } from '../../../../../modules/ai-tools';
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
 * Editable policy form for one tool. Local form state seeds from the tool's
 * current override so each editor edits independently; Save stays disabled until
 * a field actually changes so an unchanged editor never invites a no-op write.
 *
 * @param props.tool - The tool whose override is being edited; supplies name and capability.
 * @param props.override - The tool's current saved override, or undefined when it runs on class defaults.
 * @param props.usage - Audit-trail tallies for the tool, shown so an admin tunes against real traffic.
 * @param props.defaults - The governor's resolved class defaults, used to label the inherited option with its actual behaviour.
 * @param props.onChanged - Called after a save or clear so the Registry can refetch policy (override badge, seed) and re-check the trifecta.
 * @returns The policy editor form.
 */
export function ToolPolicyEditor({ tool, override, usage, defaults, onChanged }: {
    tool: IAiToolInfo;
    override?: IToolPolicy;
    usage?: Usage;
    defaults?: { requireApproval: boolean; allowUnattended: boolean };
    onChanged: () => void;
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
    // central queue; for others the field is hidden rather than shown as a live
    // no-op.
    const curationCapable = tool.capability?.forcesCuratorReview === true;

    // Label the inherited ("Default") option with the value it resolves to, so
    // an admin reading a field sees the actual behaviour rather than the opaque
    // word "Default". The resolved value is the governor's own class default
    // (from GET /policy), not a re-derivation here.
    const approvalDefaultLabel = defaults ? `Default (${defaults.requireApproval ? 'On' : 'Off'})` : 'Default';
    const unattendedDefaultLabel = defaults ? `Default (${defaults.allowUnattended ? 'On' : 'Off'})` : 'Default';
    // Curation has no per-tool entry in GET /policy `defaults` because the
    // governor's derived default for any curation-capable tool is always
    // `require`. Label the inherited option with that resolved value so the
    // curation field reads the same way as the approval/unattended ones.
    const curationDefaultLabel = 'Default (Require)';

    // Pending edits relative to the saved override. Save stays disabled until a
    // field actually changes.
    const dirty =
        requireApproval !== triFrom(override?.requireApproval) ||
        allowUnattended !== triFrom(override?.allowUnattended) ||
        rateMax !== (override?.rateLimit ? String(override.rateLimit.max) : '') ||
        costCeiling !== (override?.costCeilingUsd !== undefined ? String(override.costCeilingUsd) : '') ||
        curation !== curationFrom(override?.curation);

    // A number field is acceptable only when blank (blank inherits the class
    // default) or a finite value >= 0 — exactly the accept-condition `save()`
    // applies before writing it. Checking the same condition here, and gating
    // Save on it below, keeps a value that would otherwise be silently dropped
    // (e.g. a typed/pasted `-5`, which `<input type="number" min={0}>` renders
    // but does not block) from producing a misleading "saved" toast.
    const numberFieldValid = (raw: string): boolean => {
        if (raw.trim() === '') {
            return true;
        }
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed >= 0;
    };
    const numbersValid = numberFieldValid(rateMax) && numberFieldValid(costCeiling);

    // Re-seed the form when the override prop changes out from under an *idle*
    // editor — but never while the admin has pending edits. The parent refetches
    // every tool's policy on any save/clear/toggle (handlePolicyChanged → load),
    // so each reload hands this editor a fresh `override` object identity even
    // when its value is unchanged; gating on `!dirty` keeps that churn from
    // clobbering half-typed values here. The post-Clear reset is handled
    // explicitly in `clear()` rather than here, because immediately after a
    // clear the form reads as dirty (its forced values vs the now-absent
    // override), so this guard would (correctly) decline to touch it.
    useEffect(() => {
        if (dirty) {
            return;
        }
        setRequireApproval(triFrom(override?.requireApproval));
        setAllowUnattended(triFrom(override?.allowUnattended));
        setRateMax(override?.rateLimit ? String(override.rateLimit.max) : '');
        setCostCeiling(override?.costCeilingUsd !== undefined ? String(override.costCeilingUsd) : '');
        setCuration(curationFrom(override?.curation));
        // `dirty` derives from `override` plus the field state; listing `override`
        // is sufficient to re-run on a prop change, and the guard re-reads the
        // latest `dirty` each run.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [override]);

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
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusy(false);
        }
    }, [requireApproval, allowUnattended, rateMax, costCeiling, curation, tool.name, push, onChanged]);

    const clear = useCallback(async () => {
        setBusy(true);
        try {
            await clearPolicy(tool.name);
            // Reset the form to the inherited defaults now. The override prop will
            // follow via onChanged → reload, but resetting here is what disarms the
            // stale forced values (and the re-armed Save button), since right after
            // a clear the form would otherwise read as dirty against the now-absent
            // override and the `!dirty`-gated sync effect would decline to touch it.
            setRequireApproval('inherit');
            setAllowUnattended('inherit');
            setRateMax('');
            setCostCeiling('');
            setCuration('inherit');
            push({ tone: 'info', title: `Override cleared for ${tool.name}` });
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Clear failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusy(false);
        }
    }, [tool.name, push, onChanged]);

    return (
        <div className={styles.tool_policy}>
            <p className={styles.policy_help}>
                Overrides force these values over the capability-class defaults. Clear reverts the tool to those defaults.
            </p>
            <div className={styles.policy_grid}>
                <label className={styles.policy_field}>
                    <span className={styles.policy_field_label}>Require approval</span>
                    <Select
                        className={styles.cell_control}
                        value={requireApproval}
                        onChange={(e) => setRequireApproval(e.target.value as TriState)}
                    >
                        <option value="inherit">{approvalDefaultLabel}</option>
                        <option value="on">On</option>
                        <option value="off">Off</option>
                    </Select>
                    <span className={styles.policy_field_help}>Hold every call for admin approval before it runs.</span>
                </label>
                <label className={styles.policy_field}>
                    <span className={styles.policy_field_label}>Allow unattended</span>
                    <Select
                        className={styles.cell_control}
                        value={allowUnattended}
                        onChange={(e) => setAllowUnattended(e.target.value as TriState)}
                    >
                        <option value="inherit">{unattendedDefaultLabel}</option>
                        <option value="on">On</option>
                        <option value="off">Off</option>
                    </Select>
                    <span className={styles.policy_field_help}>Permit scheduled / programmatic runs (external tools are otherwise barred).</span>
                </label>
                {curationCapable && (
                    <label className={styles.policy_field}>
                        <span className={styles.policy_field_label}>Curation</span>
                        <Select
                            className={styles.cell_control}
                            value={curation}
                            onChange={(e) => setCuration(e.target.value as CurationMode)}
                        >
                            <option value="inherit">{curationDefaultLabel}</option>
                            <option value="require">Require</option>
                            <option value="auto-approve">Auto-approve</option>
                        </Select>
                        <span className={styles.policy_field_help}>Auto-approve releases held effects without review — re-arms the trifecta.</span>
                    </label>
                )}
                <label className={styles.policy_field}>
                    <span className={styles.policy_field_label}>Rate / min</span>
                    <Input
                        type="number"
                        min={0}
                        value={rateMax}
                        onChange={(e) => setRateMax(e.target.value)}
                        placeholder="default"
                        className={styles.cell_control}
                    />
                    <span className={styles.policy_field_help}>Max invocations per minute; blank inherits the class default. Negative values block Save.</span>
                </label>
                <label className={styles.policy_field}>
                    <span className={styles.policy_field_label}>Cost ceiling (USD)</span>
                    <Input
                        type="number"
                        min={0}
                        step="0.01"
                        value={costCeiling}
                        onChange={(e) => setCostCeiling(e.target.value)}
                        placeholder="none"
                        className={styles.cell_control}
                    />
                    <span className={styles.policy_field_help}>Max spend per rolling 24 h; blank means no cap. Negative values block Save.</span>
                </label>
            </div>
            <div className={styles.policy_footer}>
                <span className="text-muted">
                    {usage ? `${usage.invocations} calls · ${usage.denied} denied · ${usage.needsApproval} held` : 'no activity'}
                </span>
                <div className={styles.row_actions}>
                    <Button
                        variant="primary"
                        size="sm"
                        icon={<Save size={16} />}
                        loading={busy}
                        disabled={busy || !dirty || !numbersValid}
                        onClick={() => { void save(); }}
                    >
                        Save override
                    </Button>
                    <Button
                        variant="ghost"
                        size="sm"
                        icon={<RotateCcw size={16} />}
                        disabled={busy || !hasOverride}
                        onClick={() => { void clear(); }}
                        title="Revert to capability-class defaults"
                    >
                        Clear
                    </Button>
                </div>
            </div>
        </div>
    );
}
