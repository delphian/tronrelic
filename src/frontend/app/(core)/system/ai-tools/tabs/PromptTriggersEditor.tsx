'use client';

/**
 * @file PromptTriggersEditor.tsx
 *
 * The saved prompt's autonomous firing rules, edited inline inside the Query
 * tab's Conversation card. A prompt's `triggers[]` is a discriminated array of
 * cron schedules and declared-hook bindings, each with its own enabled flag and
 * run bookkeeping, and this renders one editable row per element plus the
 * controls to add and remove them.
 *
 * Fully controlled: the parent Conversation card owns the draft rows so a single
 * Save can write the triggers together with the name, body, model pin, and tool
 * allowlist. That is why nothing here saves — the component's whole job is to
 * turn the array into rows and report edits back up.
 *
 * A client-only admin surface, mounted on a user action, so the per-30s tick
 * driving the live "next run" countdown carries no SSR hydration concern.
 */

import { useState, useEffect, useMemo, useCallback } from 'react';
import { Clock, AlertCircle, CheckCircle, Plus, CalendarClock, Webhook, Trash2 } from 'lucide-react';
import type { ISavedPromptTrigger } from '@/types';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Field } from '../../../../../components/ui/Field';
import { Select } from '../../../../../components/ui/Select';
import { Switch } from '../../../../../components/ui/Switch';
import { IconButton } from '../../../../../components/ui/IconButton';
import type { IBindableHookInfo } from '../../../../../modules/ai-tools';
import { type ITriggerDraft, makeTriggerDraftKey } from './savedPromptDraft';
import {
    CRON_PRESETS,
    describeCron,
    getMsUntilNextCron,
    getNextCronDate,
    formatLocalWallClock,
    formatTimeUntil,
    formatRelativeTime
} from './savedPromptCron';
import styles from './PromptEditor.module.scss';

/**
 * How often (ms) the editor re-renders so each cron row's "next run in Xm"
 * countdown advances on its own — fast enough to feel live, slow enough to stay
 * jank-free against a countdown that only ever displays whole minutes.
 */
const TICK_MS = 30_000;

interface PromptTriggersEditorProps {
    /**
     * Id of the prompt being edited, or `'new'` for one not yet saved. Used only
     * to namespace the generated input ids, so two editors on a page cannot
     * produce colliding `<label for>` targets.
     */
    promptId: string;
    /** The trigger rows as currently edited. */
    drafts: ITriggerDraft[];
    /** Receives the next row set after any edit, add, or removal. */
    onChange: (drafts: ITriggerDraft[]) => void;
    /**
     * The prompt's stored triggers, read only for the per-row run bookkeeping
     * (last run, last error). Server-owned, so drafts never carry or mutate it.
     */
    stored: ISavedPromptTrigger[];
    /** Declared hook seams a hook trigger may bind to; empty disables adding one. */
    bindableHooks: IBindableHookInfo[];
    /** Disable every control while a save is in flight. */
    disabled?: boolean;
}

/**
 * Editable list of a saved prompt's cron and hook triggers.
 *
 * @param props - See {@link PromptTriggersEditorProps}.
 * @returns The triggers editor.
 */
export function PromptTriggersEditor({
    promptId,
    drafts,
    onChange,
    stored,
    bindableHooks,
    disabled = false
}: PromptTriggersEditorProps) {
    const [nowTick, setNowTick] = useState<number>(() => Date.now());

    useEffect(() => {
        const intervalId = setInterval(() => setNowTick(Date.now()), TICK_MS);
        setNowTick(Date.now());
        return () => clearInterval(intervalId);
    }, []);

    /**
     * Per-element run bookkeeping keyed by trigger id — read-only display data
     * the drafts deliberately do not carry, so an edit can never overwrite a
     * timestamp the backend owns.
     */
    const bookkeeping = useMemo(
        () => new Map<string, ISavedPromptTrigger>(stored.map(trigger => [trigger.id, trigger])),
        [stored]
    );

    /**
     * Apply a partial edit to one row, addressed by its stable local key so
     * sibling rows keep their input state untouched.
     *
     * @param key - The row's local list key.
     * @param patch - The fields to change on that row.
     */
    const updateDraft = useCallback((key: string, patch: Partial<ITriggerDraft>) => {
        onChange(drafts.map(draft => (draft.key === key ? { ...draft, ...patch } : draft)));
    }, [drafts, onChange]);

    /**
     * Drop one row. The removal only reaches the server on the next Save, which
     * is why the button's title says so — an operator should not think a trigger
     * has stopped firing the moment the row disappears.
     *
     * @param key - The row's local list key.
     */
    const removeDraft = useCallback((key: string) => {
        onChange(drafts.filter(draft => draft.key !== key));
    }, [drafts, onChange]);

    /**
     * Append a new enabled row of the given kind. A hook row pre-selects the
     * first bindable seam so it is saveable immediately rather than starting in
     * the invalid "no hook chosen" state that blocks Save.
     *
     * @param kind - Which trigger kind to add.
     */
    const addDraft = useCallback((kind: 'cron' | 'hook') => {
        onChange([...drafts, {
            // Page-lifetime unique: this component unmounts whenever the section
            // is collapsed, so a per-instance counter would restart and collide
            // with keys already held in the parent's drafts.
            key: makeTriggerDraftKey(),
            kind,
            enabled: true,
            cron: '',
            hookId: kind === 'hook' ? (bindableHooks[0]?.id ?? '') : '',
            typeIdFilter: ''
        }]);
    }, [drafts, onChange, bindableHooks]);

    return (
        <div className={styles.triggers}>
            <p className={styles.field_hint}>
                Autonomous firing rules — cron schedules and hook bindings. Each trigger pauses and fails
                independently; a prompt with no triggers only runs when you send it or use Run now.
            </p>

            {drafts.map(draft => {
                const runInfo = draft.id ? bookkeeping.get(draft.id) : undefined;
                const cronDescription = draft.kind === 'cron' ? describeCron(draft.cron) : null;
                const cronInvalid = draft.kind === 'cron' && cronDescription === null;
                const msUntilNext = draft.kind === 'cron' && !cronInvalid
                    ? getMsUntilNextCron(draft.cron, nowTick)
                    : null;
                const nextDate = draft.kind === 'cron' && !cronInvalid
                    ? getNextCronDate(draft.cron, nowTick)
                    : null;
                const hookInfo = draft.kind === 'hook'
                    ? bindableHooks.find(hook => hook.id === draft.hookId)
                    : undefined;
                return (
                    <div key={draft.key} className={styles.trigger_row}>
                        <div className={styles.trigger_header}>
                            <span className={styles.trigger_kind}>
                                {draft.kind === 'cron'
                                    ? <><CalendarClock size={14} /> Cron schedule</>
                                    : <><Webhook size={14} /> Hook binding</>}
                            </span>
                            <div className={styles.trigger_header_actions}>
                                <Switch
                                    on={draft.enabled}
                                    onChange={(next) => updateDraft(draft.key, { enabled: next })}
                                    size="sm"
                                    disabled={disabled}
                                    aria-label={draft.enabled ? 'Disable trigger' : 'Enable trigger'}
                                />
                                <span className={styles.trigger_enabled_label}>
                                    {draft.enabled ? 'Enabled' : 'Paused'}
                                </span>
                                <IconButton
                                    variant="danger"
                                    size="sm"
                                    onClick={() => removeDraft(draft.key)}
                                    disabled={disabled}
                                    aria-label="Remove trigger"
                                    title="Remove this trigger (takes effect on save)"
                                >
                                    <Trash2 size={12} />
                                </IconButton>
                            </div>
                        </div>

                        {draft.kind === 'cron' ? (
                            <>
                                {/*
                                  * Field owns the label, the message, and the
                                  * aria-describedby between them. The valid case
                                  * rides through as `hint`, keeping its tick and
                                  * the plain-English reading of the expression,
                                  * which is guidance rather than a fault.
                                  */}
                                <Field
                                    className={styles.cron_field}
                                    label="Cron expression (UTC)"
                                    htmlFor={`trigger-cron-${promptId}-${draft.key}`}
                                    error={
                                        cronInvalid
                                            ? draft.cron.trim()
                                                ? 'Invalid cron expression'
                                                : 'A cron expression is required'
                                            : undefined
                                    }
                                    hint={
                                        <span className={styles.schedule_description_ok}>
                                            <CheckCircle size={12} /> {cronDescription}
                                        </span>
                                    }
                                >
                                    <Input
                                        id={`trigger-cron-${promptId}-${draft.key}`}
                                        type="text"
                                        value={draft.cron}
                                        onChange={(e) => updateDraft(draft.key, { cron: e.target.value })}
                                        placeholder="0 * * * *"
                                        className={styles.cron_input}
                                        disabled={disabled}
                                        invalid={cronInvalid}
                                    />
                                </Field>
                                {msUntilNext !== null && (
                                    <div className={styles.next_run}>
                                        <Clock size={12} />
                                        <span>
                                            Next run {formatTimeUntil(msUntilNext)}
                                            {nextDate && ` (${formatLocalWallClock(nextDate)})`}
                                            {!draft.enabled && (
                                                <span className={styles.next_run_paused}> (paused)</span>
                                            )}
                                        </span>
                                    </div>
                                )}
                                <div className={styles.presets}>
                                    {CRON_PRESETS.map(preset => (
                                        <Button
                                            key={preset.cron}
                                            variant="ghost"
                                            size="xs"
                                            onClick={() => updateDraft(draft.key, { cron: preset.cron })}
                                            disabled={disabled}
                                        >
                                            {preset.label}
                                        </Button>
                                    ))}
                                </div>
                                <p className={styles.field_hint}>
                                    Evaluated on the master tick (every 2 minutes).
                                </p>
                            </>
                        ) : (
                            <>
                                <label className={styles.field_label} htmlFor={`trigger-hook-${promptId}-${draft.key}`}>
                                    Hook
                                </label>
                                <Select
                                    id={`trigger-hook-${promptId}-${draft.key}`}
                                    className={styles.full_width_select}
                                    value={draft.hookId}
                                    onChange={(e) => updateDraft(draft.key, { hookId: e.target.value })}
                                    disabled={disabled}
                                    aria-label="Hook to bind"
                                >
                                    {!draft.hookId && <option value="">Select a hook…</option>}
                                    {draft.hookId && !bindableHooks.some(hook => hook.id === draft.hookId) && (
                                        <option value={draft.hookId}>{draft.hookId}</option>
                                    )}
                                    {bindableHooks.map(hook => (
                                        <option key={hook.id} value={hook.id}>{hook.id}</option>
                                    ))}
                                </Select>
                                {hookInfo && (
                                    <p className={styles.field_hint}>{hookInfo.description}</p>
                                )}
                                <label className={styles.field_label} htmlFor={`trigger-filter-${promptId}-${draft.key}`}>
                                    Content-type filter (optional)
                                </label>
                                <Input
                                    id={`trigger-filter-${promptId}-${draft.key}`}
                                    type="text"
                                    value={draft.typeIdFilter}
                                    onChange={(e) => updateDraft(draft.key, { typeIdFilter: e.target.value })}
                                    placeholder="blog:post — blank fires on every event"
                                    disabled={disabled}
                                    aria-label="Content-type filter"
                                />
                                <p className={styles.field_hint}>
                                    Fires only when the event&apos;s content type matches; the hook payload reaches the
                                    prompt as {'{%hook.*%}'} variables. Runs are queued, never inline.
                                </p>
                            </>
                        )}

                        {runInfo?.lastRunAt && (
                            <div className={styles.last_run}>
                                Last run {formatRelativeTime(runInfo.lastRunAt)}
                                {runInfo.lastRunError && (
                                    <span className={styles.last_run_error}>
                                        {' · '}<AlertCircle size={11} /> {runInfo.lastRunError}
                                    </span>
                                )}
                            </div>
                        )}
                    </div>
                );
            })}

            {drafts.length === 0 && (
                <p className={styles.field_hint}>No triggers — this prompt runs manually only.</p>
            )}

            <div className={styles.trigger_actions}>
                <Button variant="ghost" size="xs" onClick={() => addDraft('cron')} disabled={disabled}>
                    <Plus size={12} /> Add cron trigger
                </Button>
                <Button
                    variant="ghost"
                    size="xs"
                    onClick={() => addDraft('hook')}
                    disabled={disabled || bindableHooks.length === 0}
                    title={bindableHooks.length === 0 ? 'No bindable hooks available' : undefined}
                >
                    <Plus size={12} /> Add hook trigger
                </Button>
            </div>
        </div>
    );
}
