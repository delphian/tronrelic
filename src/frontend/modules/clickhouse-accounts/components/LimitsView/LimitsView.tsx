'use client';

/**
 * @fileoverview The Limits view of a managed ClickHouse account: every limit
 * as a headroom gauge, and an editor for changing them with a stated reason.
 *
 * Each gauge's track is the ceiling set in code, the filled part is the value
 * in force, and a tick marks the code default. That shows at a glance how much
 * room an admin has given the account relative to what code review allowed,
 * which a bare number cannot. When ClickHouse reports a different value from
 * the one stored, a warning marker shows where the server actually is, because
 * that difference means someone changed the server by hand.
 */

import { useMemo, useState, type FormEvent } from 'react';
import { Pencil } from 'lucide-react';
import type { IClickHouseAccountLimits, IClickHouseAccountSummary } from '@/types';
import { Stack } from '../../../../components/layout';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { Field } from '../../../../components/ui/Field';
import { Input } from '../../../../components/ui/Input';
import { Textarea } from '../../../../components/ui/Textarea';
import { useToast } from '../../../../components/ui/ToastProvider';
import { updateClickHouseAccountLimits } from '../../api/client';
import { formatExact } from '../../lib/formatQuantity';
import { LIMIT_FIELDS, LIMIT_GROUPS, serverDrift, type ILimitField } from '../../lib/limitFields';
import styles from './LimitsView.module.scss';

/**
 * Props for the Limits view.
 */
interface ILimitsViewProps {
    /** A managed account; its `limits`, `ceilings`, and `defaultLimits` are present. */
    account: IClickHouseAccountSummary;
    /** Called with the updated summary after a save, so the parent can replace its copy. */
    onUpdated: (account: IClickHouseAccountSummary) => void;
}

/**
 * Show a managed account's limits as gauges, with an editor behind a button.
 *
 * @param props - The account and the update callback.
 * @returns The Limits view.
 */
export function LimitsView({ account, onUpdated }: ILimitsViewProps) {
    const [editing, setEditing] = useState(false);
    const limits = account.limits as IClickHouseAccountLimits;
    const ceilings = account.ceilings as IClickHouseAccountLimits;
    const defaults = account.defaultLimits as IClickHouseAccountLimits;

    /**
     * Hand a saved summary to the parent and return to the gauges, so the
     * admin sees the new values in the same form they are always shown in.
     *
     * @param updated - The summary the server returned after the save.
     */
    const handleSaved = (updated: IClickHouseAccountSummary) => {
        onUpdated(updated);
        setEditing(false);
    };

    return editing ? (
        <LimitsEditor
            account={account}
            limits={limits}
            ceilings={ceilings}
            defaults={defaults}
            onCancel={() => setEditing(false)}
            onSaved={handleSaved}
        />
    ) : (
        <Stack gap="md">
            <div className={styles.toolbar}>
                <p className={styles.legend}>
                    <span className={styles.legend_fill} aria-hidden="true" /> In force
                    <span className={styles.legend_tick} aria-hidden="true" /> Default
                    <span className={styles.legend_end}>The track ends at the ceiling set in code.</span>
                </p>
                <Button variant="secondary" size="sm" icon={<Pencil size={14} aria-hidden="true" />} onClick={() => setEditing(true)}>
                    Change limits
                </Button>
            </div>
            {LIMIT_GROUPS.map(({ group, title, note }) => (
                <section key={group} className={styles.group} aria-labelledby={`${account.id}-${group}-title`}>
                    <h5 id={`${account.id}-${group}-title`} className={styles.group_title}>{title}</h5>
                    <p className={styles.group_note}>{note}</p>
                    <ul className={styles.gauges}>
                        {LIMIT_FIELDS.filter(field => field.group === group).map(field => (
                            <LimitGauge
                                key={field.key}
                                field={field}
                                value={limits[field.key]}
                                ceiling={ceilings[field.key]}
                                defaultValue={defaults[field.key]}
                                drift={serverDrift(field, limits[field.key], account.effectiveSettings)}
                            />
                        ))}
                    </ul>
                </section>
            ))}
        </Stack>
    );
}

/**
 * Props for one gauge row.
 */
interface ILimitGaugeProps {
    /** Which limit this row shows. */
    field: ILimitField;
    /** Value in force. */
    value: number;
    /** Ceiling set in code; the track's full length. */
    ceiling: number;
    /** Code default, marked with a tick. */
    defaultValue: number;
    /** The server's value when it differs from `value`, otherwise null. */
    drift: number | null;
}

/**
 * One limit as a labelled headroom gauge.
 *
 * The track is exposed to assistive technology as a `meter`, with the value
 * and ceiling spelled out in `aria-valuetext`, because the visual length alone
 * tells a screen reader nothing.
 *
 * @param props - The limit, its values, and any drift.
 * @returns A list item.
 */
function LimitGauge({ field, value, ceiling, defaultValue, drift }: ILimitGaugeProps) {
    /**
     * Where a value sits along the track, as a percentage clamped to the track.
     *
     * @param amount - A value in the limit's own unit.
     * @returns 0 to 100.
     */
    const position = (amount: number): number => Math.min(100, Math.max(0, (amount / ceiling) * 100));

    return (
        <li className={styles.gauge}>
            <span className={styles.gauge_label}>{field.label}</span>
            <span className={styles.gauge_value}>{field.format(value)}</span>
            <span
                className={styles.track}
                role="meter"
                aria-label={field.label}
                aria-valuemin={0}
                aria-valuemax={ceiling}
                aria-valuenow={value}
                aria-valuetext={`${field.format(value)} of a ${field.format(ceiling)} ceiling; default ${field.format(defaultValue)}`}
            >
                <span className={styles.track_fill} style={{ inlineSize: `${position(value)}%` }} />
                <span className={styles.track_default} style={{ insetInlineStart: `${position(defaultValue)}%` }} />
                {drift !== null && (
                    <span className={styles.track_drift} style={{ insetInlineStart: `${position(drift)}%` }} />
                )}
            </span>
            <span className={styles.gauge_ceiling}>of {field.format(ceiling)}</span>
            {drift !== null && (
                <span className={styles.gauge_drift}>
                    <Badge tone="warning" size="xs">ClickHouse reports {field.format(drift)}</Badge>
                </span>
            )}
        </li>
    );
}

/**
 * Props for the limits editor.
 */
interface ILimitsEditorProps {
    /** The account being edited. */
    account: IClickHouseAccountSummary;
    /** Values in force, used as the editor's starting values. */
    limits: IClickHouseAccountLimits;
    /** Highest value allowed per field. */
    ceilings: IClickHouseAccountLimits;
    /** Code defaults, offered as a reference in each field's hint. */
    defaults: IClickHouseAccountLimits;
    /** Leave the editor without saving. */
    onCancel: () => void;
    /** Called with the updated summary after a successful save. */
    onSaved: (account: IClickHouseAccountSummary) => void;
}

/**
 * Edit a managed account's limits.
 *
 * Only changed fields are sent, so the audit entry records exactly what the
 * admin meant to change. A reason is required, because the audit trail exists
 * to answer "why was this raised" months later. Each field is checked here
 * against its ceiling so a mistake is caught before the request, and the
 * server checks again, since it is the authority.
 *
 * @param props - Values, bounds, and callbacks.
 * @returns The editor form.
 */
function LimitsEditor({ account, limits, ceilings, defaults, onCancel, onSaved }: ILimitsEditorProps) {
    const { push } = useToast();
    const [draft, setDraft] = useState<Record<string, string>>(
        () => Object.fromEntries(LIMIT_FIELDS.map(field => [field.key, String(limits[field.key])]))
    );
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    /**
     * Each field's parsed value and any problem with it, recomputed as the
     * admin types.
     */
    const checked = useMemo(() => LIMIT_FIELDS.map(field => {
        const raw = draft[field.key].trim();
        const value = Number(raw);
        let error: string | null = null;
        if (!/^\d+$/.test(raw) || !Number.isSafeInteger(value) || value < 1) {
            error = 'Enter a whole number of at least 1.';
        } else if (value > ceilings[field.key]) {
            error = `The ceiling is ${formatExact(ceilings[field.key])}.`;
        }
        return { field, value, error };
    }), [draft, ceilings]);

    const changes = checked.filter(entry => entry.error === null && entry.value !== limits[entry.field.key]);
    const hasErrors = checked.some(entry => entry.error !== null);
    const canSave = !hasErrors && changes.length > 0 && reason.trim().length > 0 && !saving;

    /**
     * Send the changed fields and the reason, then report the outcome.
     *
     * @param event - The form submission, prevented so the page does not reload.
     */
    const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (canSave) {
            setSaving(true);
            try {
                const patch = Object.fromEntries(changes.map(entry => [entry.field.key, entry.value])) as Partial<IClickHouseAccountLimits>;
                const updated = await updateClickHouseAccountLimits(account.id, patch, reason.trim());
                push({ tone: 'success', title: 'Limits saved', description: `${account.label}: ${changes.length} limit${changes.length === 1 ? '' : 's'} changed.` });
                onSaved(updated);
            } catch (error) {
                push({ tone: 'danger', title: 'Limits not saved', description: error instanceof Error ? error.message : String(error) });
            } finally {
                setSaving(false);
            }
        }
    };

    return (
        <form className={styles.editor} onSubmit={handleSubmit} noValidate>
            {LIMIT_GROUPS.map(({ group, title }) => (
                <fieldset key={group} className={styles.editor_group}>
                    <legend className={styles.group_title}>{title}</legend>
                    <div className={styles.editor_fields}>
                        {checked.filter(entry => entry.field.group === group).map(({ field, value, error }) => {
                            const inputId = `${account.id}-limit-${field.key}`;
                            return (
                                <Field
                                    key={field.key}
                                    label={field.label}
                                    htmlFor={inputId}
                                    hint={`${Number.isFinite(value) ? field.format(value) : '—'}. Default ${field.format(defaults[field.key])}, ceiling ${field.format(ceilings[field.key])}.`}
                                    error={error ?? undefined}
                                >
                                    <Input
                                        id={inputId}
                                        inputMode="numeric"
                                        size="sm"
                                        value={draft[field.key]}
                                        invalid={error !== null}
                                        onChange={event => setDraft(current => ({ ...current, [field.key]: event.target.value }))}
                                    />
                                </Field>
                            );
                        })}
                    </div>
                </fieldset>
            ))}
            <Field
                label="Why are you changing these limits?"
                htmlFor={`${account.id}-limit-reason`}
                hint="Saved with the change, so the next admin can see why it was made."
                required
            >
                <Textarea
                    id={`${account.id}-limit-reason`}
                    rows={2}
                    maxLength={500}
                    value={reason}
                    onChange={event => setReason(event.target.value)}
                />
            </Field>
            <div className={styles.editor_actions}>
                <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
                    Cancel
                </Button>
                <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!canSave}>
                    Save limits
                </Button>
            </div>
        </form>
    );
}
