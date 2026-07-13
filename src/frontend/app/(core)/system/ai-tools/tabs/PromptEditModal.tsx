'use client';

/**
 * @file PromptEditModal.tsx
 *
 * Focused saved-prompt editor rendered inside the shared modal from the Query
 * tab's SavedPromptsPanel. Independent save paths — name+body, tools, and the
 * triggers set — so a trigger save never clears an in-progress body edit and
 * vice versa (each request omits the other's fields and the server upsert
 * preserves them). The Triggers section edits the unified `triggers[]` array:
 * any number of cron schedules and declared-hook bindings, each with its own
 * enabled flag and run bookkeeping. Owns its draft state and a 30s tick that
 * drives the live "next run" countdown. Pure client surface (only mounts on a
 * user click), so loading states and Date-based countdowns are appropriate.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Save, Clock, AlertCircle, CheckCircle, Plus, CalendarClock, Webhook, Trash2 } from 'lucide-react';
import type { ISavedPrompt, ISavedPromptTrigger, IAiToolInfo, ITrifectaStatus } from '@/types';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Textarea } from '../../../../../components/ui/Textarea';
import { Select } from '../../../../../components/ui/Select';
import { Switch } from '../../../../../components/ui/Switch';
import { IconButton } from '../../../../../components/ui/IconButton';
import {
    saveSavedPrompt,
    getQueryProviders,
    listTools,
    getTrifectaPreview,
    listPromptTriggerHooks,
    type IAiProviderModels,
    type IBindableHookInfo,
    type ISavedPromptTriggerRequest
} from '../../../../../modules/ai-tools';
import { ToolAllowlistPicker } from '../components/ToolAllowlistPicker';
import { RunTrifectaBadge } from '../components/RunTrifectaBadge';
import {
    CRON_PRESETS,
    describeCron,
    getMsUntilNextCron,
    getNextCronDate,
    formatLocalWallClock,
    formatTimeUntil,
    formatRelativeTime
} from './savedPromptCron';
import styles from './SavedPromptsPanel.module.scss';

/**
 * Editable draft of one trigger element. Flattens both discriminants into one
 * shape so a row's inputs bind without narrowing; `key` is a stable local list
 * key (the server id for existing elements, a local counter for new ones) so
 * removing a row never re-keys its siblings and loses their input state.
 */
interface ITriggerDraft {
    /** Stable React list key — never sent to the server. */
    key: string;
    /** Server-assigned trigger id, preserved so run bookkeeping survives edits. */
    id?: string;
    /** Discriminator: cron schedule or declared-hook binding. */
    kind: 'cron' | 'hook';
    /** Whether this trigger fires. */
    enabled: boolean;
    /** Cron expression draft (cron kind only). */
    cron: string;
    /** Declared hook id draft (hook kind only). */
    hookId: string;
    /** Optional content-type filter draft (hook kind only). */
    typeIdFilter: string;
}

/**
 * Map a prompt's stored triggers into editable drafts, flattening the
 * discriminated union so every row binds the same input set.
 *
 * @param triggers - The prompt's stored trigger set (absent = manual-only).
 * @returns One draft per stored trigger, keyed by the server id.
 */
function toTriggerDrafts(triggers: ISavedPromptTrigger[] | undefined): ITriggerDraft[] {
    return (triggers ?? []).map(trigger => ({
        key: trigger.id,
        id: trigger.id,
        kind: trigger.kind,
        enabled: trigger.enabled,
        cron: trigger.kind === 'cron' ? trigger.cron : '',
        hookId: trigger.kind === 'hook' ? trigger.hookId : '',
        typeIdFilter: trigger.kind === 'hook' ? (trigger.typeIdFilter ?? '') : ''
    }));
}

interface PromptEditModalProps {
    /** The prompt being edited. Seeds the draft state. */
    prompt: ISavedPrompt;
    /** Called with the server's refreshed list after each successful save. */
    onSaved: (prompts: ISavedPrompt[]) => void;
    /** Report a save error to the parent (surfaced in the chat error banner). */
    onError: (message: string) => void;
}

/**
 * Saved-prompt editor with separate Save buttons for name+body, the tool
 * allowlist, and the trigger set.
 *
 * @param props.prompt - The prompt to edit.
 * @param props.onSaved - Receives the updated list after a save.
 * @param props.onError - Receives a save error message.
 * @returns The editor body for the modal.
 */
export function PromptEditModal({ prompt, onSaved, onError }: PromptEditModalProps) {
    const [nameDraft, setNameDraft] = useState(prompt.name);
    const [bodyDraft, setBodyDraft] = useState(prompt.prompt);
    // The model pin encodes both provider and model as `providerId|model` so a
    // single picker value carries which transport to route a scheduled run to —
    // models span providers, so the model id alone is ambiguous. Empty means
    // "active provider, default model".
    const [modelDraft, setModelDraft] = useState<string>(
        prompt.providerId && prompt.model ? `${prompt.providerId}|${prompt.model}` : ''
    );
    const [providers, setProviders] = useState<IAiProviderModels[]>([]);
    const [triggerDrafts, setTriggerDrafts] = useState<ITriggerDraft[]>(() => toTriggerDrafts(prompt.triggers));
    const [bindableHooks, setBindableHooks] = useState<IBindableHookInfo[]>([]);
    const [bodySaving, setBodySaving] = useState(false);
    const [triggersSaving, setTriggersSaving] = useState(false);
    /** Monotonic counter minting stable local keys for newly added trigger rows. */
    const newTriggerKeyRef = useRef(0);

    // Tool allowlist section. `toolsLoaded` gates the trifecta preview so it
    // never fires against the transient pre-seed selection. A prompt that already
    // carries an explicit allowlist (including `[]`) seeds from it verbatim;
    // one with none (undefined) is pre-filled with every enabled tool once the
    // registry loads — least privilege is opt-in narrowing, not the default.
    const [tools, setTools] = useState<IAiToolInfo[]>([]);
    const [toolsLoaded, setToolsLoaded] = useState(false);
    const [toolAllowlistDraft, setToolAllowlistDraft] = useState<string[]>(prompt.toolAllowlist ?? []);
    const [toolsSaving, setToolsSaving] = useState(false);
    const [trifecta, setTrifecta] = useState<ITrifectaStatus | null>(null);
    const [trifectaLoading, setTrifectaLoading] = useState(false);
    const prefilledRef = useRef(false);
    // Whether the operator actually engaged the Tools picker this session. The
    // prefill seeds the draft to the full enabled set for display, which is
    // indistinguishable from a deliberate "select all"; this flag records real
    // intent so an untouched save of an unset prompt reverts to the auto-updating
    // state rather than freezing today's full set. Set only from the picker's
    // onChange — never from the prefill effect.
    const [toolsTouched, setToolsTouched] = useState(false);

    // Load the tool registry for the allowlist picker and seed the pre-fill.
    // Secondary data on a click-mounted surface, so a loading gap and a quiet
    // failure (picker shows empty) are both acceptable.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await listTools();
                if (cancelled) {
                    return;
                }
                setTools(list);
                if (prompt.toolAllowlist === undefined && !prefilledRef.current) {
                    setToolAllowlistDraft(list.filter(tool => tool.enabled).map(tool => tool.name));
                }
                // Only arm Save/preview once the registry actually loaded. On a failed
                // load the draft is still the seed (`[]` when the prompt carried no
                // allowlist), and enabling Save there would silently overwrite an
                // "all enabled tools" prompt to "no tools" and break scheduled runs.
                setToolsLoaded(true);
            } catch {
                /* picker shows no options; Save stays disabled until a load succeeds */
            } finally {
                if (!cancelled) {
                    prefilledRef.current = true;
                }
            }
        })();
        return () => { cancelled = true; };
    }, [prompt.toolAllowlist]);

    // Recompute the scoped trifecta whenever the selection settles. Debounced so
    // rapid toggling issues one request, not one per checkbox. The verdict is
    // server-computed (it depends on live curation/policy state and provider
    // server-tools that the client cannot see), so this only renders the result.
    useEffect(() => {
        if (!toolsLoaded) {
            return;
        }
        let cancelled = false;
        setTrifectaLoading(true);
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const status = await getTrifectaPreview(toolAllowlistDraft);
                    if (!cancelled) {
                        setTrifecta(status);
                    }
                } catch {
                    if (!cancelled) {
                        setTrifecta(null);
                    }
                } finally {
                    if (!cancelled) {
                        setTrifectaLoading(false);
                    }
                }
            })();
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [toolAllowlistDraft, toolsLoaded]);

    // Load the bindable-hook catalog for the hook picker. Secondary data on a
    // click-mounted surface: a quiet failure leaves the picker empty and the
    // "Add hook trigger" button disabled, never a broken save.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const hooks = await listPromptTriggerHooks();
                if (!cancelled) {
                    setBindableHooks(hooks);
                }
            } catch {
                /* picker stays empty; hook triggers cannot be added */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Load the model catalog across every registered provider for the picker.
    // Secondary data on a click-mounted surface, so a loading gap and a quiet
    // failure (picker shows only "Default") are both acceptable.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await getQueryProviders();
                if (!cancelled) {
                    setProviders(list);
                }
            } catch {
                /* picker falls back to the Default option only */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Per-30s tick drives the "next run in Xm" countdown without a manual
    // refresh: fast enough to feel live, slow enough to stay jank-free.
    const [nowTick, setNowTick] = useState<number>(() => Date.now());
    useEffect(() => {
        const intervalId = setInterval(() => setNowTick(Date.now()), 30_000);
        setNowTick(Date.now());
        return () => clearInterval(intervalId);
    }, []);

    /**
     * Per-element run bookkeeping keyed by trigger id, from the prompt's stored
     * triggers — read-only display data (last run, last error) the drafts never
     * carry or mutate.
     */
    const triggerBookkeeping = useMemo(
        () => new Map<string, ISavedPromptTrigger>((prompt.triggers ?? []).map(trigger => [trigger.id, trigger])),
        [prompt.triggers]
    );

    /**
     * Whether any draft is unsaveable: a cron element with an empty or
     * unparseable expression, or a hook element with no hook selected. Gates
     * the Save button so the backend's 400 is never the first feedback.
     */
    const hasInvalidTrigger = triggerDrafts.some(draft => (
        draft.kind === 'cron'
            ? describeCron(draft.cron) === null
            : !draft.hookId.trim()
    ));

    /**
     * Persist name + body edits. Trigger fields are omitted so the server
     * upsert preserves whatever triggers are currently set.
     */
    const handleSaveBody = useCallback(async () => {
        const trimmedName = nameDraft.trim();
        const trimmedBody = bodyDraft.trim();
        if (!trimmedName || !trimmedBody) {
            return;
        }
        // Split the encoded picker value back into provider + model. Empty draft
        // sends `null` for both, clearing any existing pin (revert to the active
        // provider's default model). The model lives in this section, so it is
        // saved with name + body.
        const sep = modelDraft.indexOf('|');
        const providerId = sep >= 0 ? modelDraft.slice(0, sep) : null;
        const model = sep >= 0 ? modelDraft.slice(sep + 1) : null;
        setBodySaving(true);
        try {
            onSaved(await saveSavedPrompt({ id: prompt.id, name: trimmedName, prompt: trimmedBody, providerId, model }));
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to update prompt');
        } finally {
            setBodySaving(false);
        }
    }, [prompt.id, nameDraft, bodyDraft, modelDraft, onSaved, onError]);

    /**
     * Record a real selection edit and update the draft. Wraps the picker's
     * onChange so every checkbox toggle and bulk action marks the Tools section as
     * engaged — distinguishing a deliberate selection from the display-only
     * prefill, which the save path treats differently.
     *
     * @param names - The next selected tool names from the picker.
     */
    const handleToolSelectionChange = useCallback((names: string[]) => {
        setToolsTouched(true);
        setToolAllowlistDraft(names);
    }, []);

    /**
     * Persist the tool allowlist while preserving the three-state contract. A
     * prompt that already carries an explicit allowlist (including `[]`), or one
     * whose Tools section the operator actually edited, saves the selection
     * verbatim. An *unset* prompt left untouched saves `null` so the server
     * `$unset`s the field back to "all enabled, auto-updating" — without this, the
     * display-only prefill would freeze it to today's full set and silently
     * exclude tools enabled later. Other sections' fields are omitted so the
     * server upsert preserves them.
     */
    const handleSaveTools = useCallback(async () => {
        setToolsSaving(true);
        try {
            const nextAllowlist = (toolsTouched || prompt.toolAllowlist !== undefined) ? toolAllowlistDraft : null;
            onSaved(await saveSavedPrompt({ id: prompt.id, toolAllowlist: nextAllowlist }));
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to update tools');
        } finally {
            setToolsSaving(false);
        }
    }, [prompt.id, prompt.toolAllowlist, toolsTouched, toolAllowlistDraft, onSaved, onError]);

    /**
     * Apply a partial edit to one trigger draft, addressed by its stable local
     * key so sibling rows keep their input state untouched.
     *
     * @param key - The draft's local list key.
     * @param patch - The fields to change on that draft.
     */
    const updateTriggerDraft = useCallback((key: string, patch: Partial<ITriggerDraft>) => {
        setTriggerDrafts(prev => prev.map(draft => (draft.key === key ? { ...draft, ...patch } : draft)));
    }, []);

    /**
     * Append a new enabled trigger draft of the given kind. A hook draft
     * pre-selects the first bindable hook so the row is saveable immediately.
     *
     * @param kind - Which trigger kind to add.
     */
    const addTriggerDraft = useCallback((kind: 'cron' | 'hook') => {
        newTriggerKeyRef.current += 1;
        setTriggerDrafts(prev => [...prev, {
            key: `new-${newTriggerKeyRef.current}`,
            kind,
            enabled: true,
            cron: '',
            hookId: kind === 'hook' ? (bindableHooks[0]?.id ?? '') : '',
            typeIdFilter: ''
        }]);
    }, [bindableHooks]);

    /**
     * Persist the complete trigger set. The server replaces the stored array
     * wholesale, merging run bookkeeping back onto elements whose `id` matches
     * an existing trigger; an empty set clears every trigger (manual-only
     * prompt). Name/body/tools fields are omitted so a trigger save never
     * clears an open edit in the other sections.
     */
    const handleSaveTriggers = useCallback(async () => {
        setTriggersSaving(true);
        try {
            const triggers: ISavedPromptTriggerRequest[] = triggerDrafts.map(draft => (
                draft.kind === 'cron'
                    ? { id: draft.id, kind: 'cron', enabled: draft.enabled, cron: draft.cron.trim() }
                    : {
                        id: draft.id,
                        kind: 'hook',
                        enabled: draft.enabled,
                        hookId: draft.hookId,
                        ...(draft.typeIdFilter.trim() ? { typeIdFilter: draft.typeIdFilter.trim() } : {})
                    }
            ));
            const saved = await saveSavedPrompt({ id: prompt.id, triggers });
            // Re-seed drafts from the server's normalized triggers so newly added
            // rows adopt their minted ids. Without this, a second in-modal save
            // resends `id: undefined` for those rows and the server treats them as
            // brand new — re-anchoring the cron and wiping run bookkeeping instead
            // of preserving the element.
            const refreshed = saved.find(p => p.id === prompt.id);
            if (refreshed) {
                setTriggerDrafts(toTriggerDrafts(refreshed.triggers));
            }
            onSaved(saved);
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to update triggers');
        } finally {
            setTriggersSaving(false);
        }
    }, [prompt.id, triggerDrafts, onSaved, onError]);

    return (
        <div className={styles.edit}>
            {/* Name + body */}
            <div className={styles.edit_section}>
                <p className={styles.section_label}>Prompt</p>
                <label className={styles.field_label} htmlFor={`prompt-name-${prompt.id}`}>Name</label>
                <Input
                    id={`prompt-name-${prompt.id}`}
                    type="text"
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                />
                <label className={styles.field_label} htmlFor={`prompt-body-${prompt.id}`}>Prompt text</label>
                <Textarea
                    id={`prompt-body-${prompt.id}`}
                    value={bodyDraft}
                    onChange={(e) => setBodyDraft(e.target.value)}
                    className={styles.textarea}
                    rows={8}
                    aria-label="Prompt body"
                />
                <label className={styles.field_label} htmlFor={`prompt-model-${prompt.id}`}>Model</label>
                <Select
                    id={`prompt-model-${prompt.id}`}
                    className={styles.model_select}
                    value={modelDraft}
                    onChange={(e) => setModelDraft(e.target.value)}
                    aria-label="Model for this prompt"
                >
                    <option value="">Default — active provider, default model</option>
                    {providers.map(provider => (
                        <optgroup key={provider.id} label={provider.active ? `${provider.label} (active)` : provider.label}>
                            {provider.models.map(model => (
                                <option key={`${provider.id}|${model.id}`} value={`${provider.id}|${model.id}`}>
                                    {model.display_name}
                                </option>
                            ))}
                        </optgroup>
                    ))}
                </Select>
                <p className={styles.field_hint}>
                    Used when this prompt runs on a schedule. Pinning a model also pins its provider, so the
                    scheduled run uses that provider even if another is active.
                </p>
                <div className={styles.edit_actions}>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => { void handleSaveBody(); }}
                        disabled={bodySaving || !bodyDraft.trim() || !nameDraft.trim()}
                    >
                        <Save size={14} /> {bodySaving ? 'Saving…' : 'Save prompt'}
                    </Button>
                </div>
            </div>

            {/* Tools */}
            <div className={styles.edit_section}>
                <p className={styles.section_label}>Tools</p>
                <p className={styles.field_hint}>
                    Tools this prompt may call. New prompts start with every enabled tool — narrow to the
                    least set the prompt needs. An empty selection runs the prompt with no tools. Naming a
                    tool that is later disabled or removed fails the run, so keep the list current.
                </p>
                <ToolAllowlistPicker
                    tools={tools}
                    selected={toolAllowlistDraft}
                    onChange={handleToolSelectionChange}
                    disabled={toolsSaving}
                />
                <RunTrifectaBadge status={trifecta} loading={trifectaLoading} />
                <div className={styles.edit_actions}>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => { void handleSaveTools(); }}
                        disabled={toolsSaving || !toolsLoaded}
                    >
                        <Save size={14} /> {toolsSaving ? 'Saving…' : 'Save tools'}
                    </Button>
                </div>
            </div>

            {/* Triggers */}
            <div className={styles.edit_section}>
                <p className={styles.section_label}>Triggers</p>
                <p className={styles.field_hint}>
                    Autonomous firing rules — cron schedules and hook bindings. Each trigger pauses and
                    fails independently; a prompt with no triggers only runs when loaded into the composer.
                </p>

                {triggerDrafts.map(draft => {
                    const bookkeeping = draft.id ? triggerBookkeeping.get(draft.id) : undefined;
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
                                        onChange={(next) => updateTriggerDraft(draft.key, { enabled: next })}
                                        size="sm"
                                        aria-label={draft.enabled ? 'Disable trigger' : 'Enable trigger'}
                                    />
                                    <span className={styles.trigger_enabled_label}>
                                        {draft.enabled ? 'Enabled' : 'Paused'}
                                    </span>
                                    <IconButton
                                        variant="danger"
                                        size="sm"
                                        onClick={() => setTriggerDrafts(prev => prev.filter(d => d.key !== draft.key))}
                                        aria-label="Remove trigger"
                                        title="Remove this trigger (takes effect on save)"
                                    >
                                        <Trash2 size={12} />
                                    </IconButton>
                                </div>
                            </div>

                            {draft.kind === 'cron' ? (
                                <>
                                    <label className={styles.field_label} htmlFor={`trigger-cron-${prompt.id}-${draft.key}`}>
                                        Cron expression (UTC)
                                    </label>
                                    <Input
                                        id={`trigger-cron-${prompt.id}-${draft.key}`}
                                        type="text"
                                        value={draft.cron}
                                        onChange={(e) => updateTriggerDraft(draft.key, { cron: e.target.value })}
                                        placeholder="0 * * * *"
                                        className={styles.cron_input}
                                        aria-label="Cron expression (UTC)"
                                        aria-invalid={cronInvalid}
                                    />
                                    <div className={styles.schedule_description}>
                                        {cronInvalid ? (
                                            <span className={styles.schedule_description_error}>
                                                <AlertCircle size={12} /> {draft.cron.trim() ? 'Invalid cron expression' : 'A cron expression is required'}
                                            </span>
                                        ) : (
                                            <span className={styles.schedule_description_ok}>
                                                <CheckCircle size={12} /> {cronDescription}
                                            </span>
                                        )}
                                    </div>
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
                                                onClick={() => updateTriggerDraft(draft.key, { cron: preset.cron })}
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
                                    <label className={styles.field_label} htmlFor={`trigger-hook-${prompt.id}-${draft.key}`}>
                                        Hook
                                    </label>
                                    <Select
                                        id={`trigger-hook-${prompt.id}-${draft.key}`}
                                        className={styles.model_select}
                                        value={draft.hookId}
                                        onChange={(e) => updateTriggerDraft(draft.key, { hookId: e.target.value })}
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
                                    <label className={styles.field_label} htmlFor={`trigger-filter-${prompt.id}-${draft.key}`}>
                                        Content-type filter (optional)
                                    </label>
                                    <Input
                                        id={`trigger-filter-${prompt.id}-${draft.key}`}
                                        type="text"
                                        value={draft.typeIdFilter}
                                        onChange={(e) => updateTriggerDraft(draft.key, { typeIdFilter: e.target.value })}
                                        placeholder="blog:post — blank fires on every event"
                                        aria-label="Content-type filter"
                                    />
                                    <p className={styles.field_hint}>
                                        Fires only when the event&apos;s content type matches; the hook payload reaches the
                                        prompt as {'{%hook.*%}'} variables. Runs are queued, never inline.
                                    </p>
                                </>
                            )}

                            {bookkeeping?.lastRunAt && (
                                <div className={styles.last_run}>
                                    Last run {formatRelativeTime(bookkeeping.lastRunAt)}
                                    {bookkeeping.lastRunError && (
                                        <span className={styles.last_run_error}>
                                            {' · '}<AlertCircle size={11} /> {bookkeeping.lastRunError}
                                        </span>
                                    )}
                                </div>
                            )}
                        </div>
                    );
                })}

                {triggerDrafts.length === 0 && (
                    <p className={styles.field_hint}>No triggers — this prompt runs manually only.</p>
                )}

                <div className={styles.edit_actions}>
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => addTriggerDraft('cron')}
                    >
                        <Plus size={12} /> Add cron trigger
                    </Button>
                    <Button
                        variant="ghost"
                        size="xs"
                        onClick={() => addTriggerDraft('hook')}
                        disabled={bindableHooks.length === 0}
                        title={bindableHooks.length === 0 ? 'No bindable hooks available' : undefined}
                    >
                        <Plus size={12} /> Add hook trigger
                    </Button>
                </div>

                <div className={styles.edit_actions}>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => { void handleSaveTriggers(); }}
                        disabled={hasInvalidTrigger || triggersSaving}
                    >
                        <Save size={14} /> {triggersSaving ? 'Saving…' : 'Save triggers'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
