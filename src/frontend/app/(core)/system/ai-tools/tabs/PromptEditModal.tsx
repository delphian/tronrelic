'use client';

/**
 * @file PromptEditModal.tsx
 *
 * Focused saved-prompt editor rendered inside the shared modal from the Query
 * tab's SavedPromptsPanel. Two independent save paths — name+body, and the cron
 * schedule — so a schedule save never clears an in-progress body edit and vice
 * versa (each request omits the other's fields and the server upsert preserves
 * them). Owns its draft state and a 30s tick that drives the live "next run"
 * countdown. Pure client surface (only mounts on a user click), so loading
 * states and Date-based countdowns are appropriate here.
 */

import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { Save, Clock, AlertCircle, CheckCircle } from 'lucide-react';
import type { ISavedPrompt, IAiToolInfo, ITrifectaStatus } from '@/types';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Textarea } from '../../../../../components/ui/Textarea';
import { Select } from '../../../../../components/ui/Select';
import { Switch } from '../../../../../components/ui/Switch';
import { saveSavedPrompt, getQueryProviders, listTools, getTrifectaPreview, type IAiProviderModels } from '../../../../../modules/ai-tools';
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

interface PromptEditModalProps {
    /** The prompt being edited. Seeds the draft state. */
    prompt: ISavedPrompt;
    /** Called with the server's refreshed list after each successful save. */
    onSaved: (prompts: ISavedPrompt[]) => void;
    /** Report a save error to the parent (surfaced in the chat error banner). */
    onError: (message: string) => void;
}

/**
 * Saved-prompt editor with separate Save buttons for name+body and for the cron
 * schedule.
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
    const [scheduleDraft, setScheduleDraft] = useState<{ cron: string; enabled: boolean }>({
        cron: prompt.cron ?? '',
        enabled: prompt.scheduleEnabled !== false
    });
    const [bodySaving, setBodySaving] = useState(false);
    const [scheduleSaving, setScheduleSaving] = useState(false);

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

    const draftDescription = useMemo(() => describeCron(scheduleDraft.cron), [scheduleDraft.cron]);
    const draftCronInvalid = scheduleDraft.cron.trim().length > 0 && draftDescription === null;
    const draftMsUntilNext = useMemo(
        () => (draftCronInvalid ? null : getMsUntilNextCron(scheduleDraft.cron, nowTick)),
        [scheduleDraft.cron, draftCronInvalid, nowTick]
    );
    const draftNextDate = useMemo(
        () => (draftCronInvalid ? null : getNextCronDate(scheduleDraft.cron, nowTick)),
        [scheduleDraft.cron, draftCronInvalid, nowTick]
    );

    /**
     * Persist name + body edits. Schedule fields are omitted so the server
     * upsert preserves whatever cron is currently set.
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
     * Persist schedule edits. Name/body fields are omitted so a schedule save
     * never clears an open body edit on the same prompt.
     */
    const handleSaveSchedule = useCallback(async () => {
        setScheduleSaving(true);
        try {
            onSaved(await saveSavedPrompt({
                id: prompt.id,
                cron: scheduleDraft.cron.trim(),
                scheduleEnabled: scheduleDraft.enabled
            }));
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to update schedule');
        } finally {
            setScheduleSaving(false);
        }
    }, [prompt.id, scheduleDraft, onSaved, onError]);

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

            {/* Schedule */}
            <div className={styles.edit_section}>
                <p className={styles.section_label}>Schedule</p>
                <label className={styles.field_label} htmlFor={`schedule-cron-${prompt.id}`}>
                    Cron expression (UTC)
                </label>
                <Input
                    id={`schedule-cron-${prompt.id}`}
                    type="text"
                    value={scheduleDraft.cron}
                    onChange={(e) => setScheduleDraft(prev => ({ ...prev, cron: e.target.value }))}
                    placeholder="0 * * * *  — leave blank to clear"
                    className={styles.cron_input}
                    aria-label="Cron expression (UTC)"
                    aria-invalid={draftCronInvalid}
                />

                <div className={styles.schedule_description}>
                    {scheduleDraft.cron.trim().length === 0 ? (
                        <span className={styles.schedule_description_muted}>
                            No schedule — saving clears any existing cron.
                        </span>
                    ) : draftCronInvalid ? (
                        <span className={styles.schedule_description_error}>
                            <AlertCircle size={12} /> Invalid cron expression
                        </span>
                    ) : (
                        <span className={styles.schedule_description_ok}>
                            <CheckCircle size={12} /> {draftDescription}
                        </span>
                    )}
                </div>

                {draftMsUntilNext !== null && (
                    <div className={styles.next_run}>
                        <Clock size={12} />
                        <span>
                            Next run {formatTimeUntil(draftMsUntilNext)}
                            {draftNextDate && ` (${formatLocalWallClock(draftNextDate)})`}
                            {!scheduleDraft.enabled && (
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
                            onClick={() => setScheduleDraft(prev => ({ ...prev, cron: preset.cron }))}
                        >
                            {preset.label}
                        </Button>
                    ))}
                </div>

                <div className={styles.enabled_row}>
                    <Switch
                        on={scheduleDraft.enabled}
                        onChange={(next) => setScheduleDraft(prev => ({ ...prev, enabled: next }))}
                        size="sm"
                        aria-label={scheduleDraft.enabled ? 'Disable schedule' : 'Enable schedule'}
                    />
                    <span>{scheduleDraft.enabled ? 'Enabled' : 'Disabled'}</span>
                    <span className={styles.enabled_hint}>— evaluated on the master tick (every 2 minutes)</span>
                </div>

                {prompt.lastRunAt && (
                    <div className={styles.last_run}>
                        Last run {formatRelativeTime(prompt.lastRunAt)}
                        {prompt.lastRunError && (
                            <span className={styles.last_run_error}>
                                {' · '}<AlertCircle size={11} /> {prompt.lastRunError}
                            </span>
                        )}
                    </div>
                )}

                <div className={styles.edit_actions}>
                    <Button
                        variant="primary"
                        size="sm"
                        onClick={() => { void handleSaveSchedule(); }}
                        disabled={draftCronInvalid || scheduleSaving}
                    >
                        <Save size={14} /> {scheduleSaving ? 'Saving…' : 'Save schedule'}
                    </Button>
                </div>
            </div>
        </div>
    );
}
