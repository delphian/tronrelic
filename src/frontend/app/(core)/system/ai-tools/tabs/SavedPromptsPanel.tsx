'use client';

/**
 * @file SavedPromptsPanel.tsx
 *
 * Collapsible saved-prompts panel for the Query tab. Lists saved prompt
 * templates with per-row load (click the name to drop it into the composer),
 * duplicate, edit, and delete, plus an inline save row that captures the
 * composer's current text. Each row shows a triggers chip linking to the
 * trigger editor (rendered in a modal). The parent owns the shared `prompts` list so the
 * composer can also see it; this panel owns its open/closed state, the first-open
 * fetch, and the action handlers.
 *
 * A pure client surface on an admin dashboard — the prompt list loads on first
 * open (loading spinner is appropriate for this secondary data), and relative
 * times only render after the user opens the panel, so no SSR hydration concern.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import {
    Bookmark,
    RefreshCw,
    Play,
    Pencil,
    CopyPlus,
    Trash2,
    CalendarClock,
    AlertTriangle
} from 'lucide-react';
import type { ISavedPrompt, ISavedPromptTrigger } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { IconButton } from '../../../../../components/ui/IconButton';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { CollapsibleSection } from '../components/CollapsibleSection';
import { listSavedPrompts, saveSavedPrompt, deleteSavedPrompt } from '../../../../../modules/ai-tools';
import { describeCron, formatRelativeTime, getMsUntilNextCron, formatTimeUntil } from './savedPromptCron';
import { PromptEditModal } from './PromptEditModal';
import styles from './SavedPromptsPanel.module.scss';

/**
 * How often (ms) the open panel re-renders so the "next run" countdown and the
 * "last run … ago" relative times advance without a manual refresh. One second
 * keeps the sub-minute countdown smooth; the work is a cheap re-render over a
 * short list, gated to while the panel is open.
 */
const TICK_MS = 1000;

/**
 * How often (ms) the open panel refetches the saved-prompt list while at least
 * one schedule is active, so a `lastRunAt` written by the backend
 * `ai-tools:run-scheduled-prompts` job appears without a page refresh. There is
 * no WebSocket signal for a scheduled run, so this poll is the refresh channel;
 * the backend job ticks every two minutes, so a 30s cadence surfaces a new run
 * within at most 30s while staying light. Gated to active schedules so an
 * all-manual prompt list never polls.
 */
const RUN_REFRESH_MS = 30_000;

/**
 * Summarize a prompt's trigger set for the row chip: the cron description for
 * a single cron, the hook id for a single hook, or a count for a mixed set —
 * enough to scan the list without opening the editor.
 *
 * @param triggers - The prompt's stored triggers.
 * @returns A short chip label, or null when the prompt has no triggers.
 */
function describeTriggers(triggers: ISavedPromptTrigger[]): string | null {
    if (triggers.length === 0) {
        return null;
    }
    if (triggers.length === 1) {
        const trigger = triggers[0];
        return trigger.kind === 'cron'
            ? (describeCron(trigger.cron) ?? 'invalid cron')
            : trigger.hookId + (trigger.typeIdFilter ? ` (${trigger.typeIdFilter})` : '');
    }
    return `${triggers.length} triggers`;
}

/**
 * The most recent run timestamp across a prompt's triggers, so the row's
 * "last run" label covers cron and hook firings alike.
 *
 * @param triggers - The prompt's stored triggers.
 * @returns The latest `lastRunAt` ISO timestamp, or null when never run.
 */
function latestRunAt(triggers: ISavedPromptTrigger[]): string | null {
    let latest: string | null = null;
    for (const trigger of triggers) {
        if (trigger.lastRunAt && (!latest || trigger.lastRunAt > latest)) {
            latest = trigger.lastRunAt;
        }
    }
    return latest;
}

/**
 * The soonest upcoming cron firing across a prompt's enabled cron triggers —
 * hook triggers have no predictable next run, so they never contribute.
 *
 * @param triggers - The prompt's stored triggers.
 * @param now - Current epoch ms.
 * @returns Milliseconds until the next firing, or null when none is scheduled.
 */
function msUntilNextRun(triggers: ISavedPromptTrigger[], now: number): number | null {
    let soonest: number | null = null;
    for (const trigger of triggers) {
        if (trigger.kind !== 'cron' || !trigger.enabled) {
            continue;
        }
        const ms = getMsUntilNextCron(trigger.cron, now);
        if (ms !== null && (soonest === null || ms < soonest)) {
            soonest = ms;
        }
    }
    return soonest;
}

interface SavedPromptsPanelProps {
    /** Shared saved-prompts list, owned by the parent Query tab. */
    prompts: ISavedPrompt[];
    /** Replace the shared list after a panel action (no refetch needed). */
    onPromptsChange: (prompts: ISavedPrompt[]) => void;
    /** Current composer text — captured by the inline Save row. */
    currentPromptText: string;
    /** Load a saved prompt's body back into the composer. */
    onLoadPromptText: (text: string) => void;
    /** Execute a saved prompt immediately as a self-contained autonomous run. */
    onRun: (sp: ISavedPrompt) => void;
    /** Surface save/duplicate/delete errors to the parent. */
    onError: (message: string) => void;
}

/**
 * Saved prompts panel: a toggleable card with an inline Save row plus a list of
 * existing prompts, each with load / edit (schedule) / duplicate / delete.
 *
 * @param props - See {@link SavedPromptsPanelProps}.
 * @returns The panel.
 */
export function SavedPromptsPanel({
    prompts,
    onPromptsChange,
    currentPromptText,
    onLoadPromptText,
    onRun,
    onError
}: SavedPromptsPanelProps) {
    const modal = useModal();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saveName, setSaveName] = useState('');
    const loadedRef = useRef(false);
    /**
     * Wall-clock used to derive the live "next run" countdown and "last run …
     * ago" labels. Ticked while the panel is open so both advance on their own;
     * only read inside the open panel body, which renders solely after a user
     * opens it, so there is no SSR hydration concern.
     */
    const [now, setNow] = useState(() => Date.now());

    /** First-open fetch. Later opens reuse the parent's list (kept fresh on writes). */
    const loadPrompts = useCallback(async () => {
        setLoading(true);
        try {
            onPromptsChange(await listSavedPrompts());
        } catch {
            // Silent — the panel renders its empty state on failure.
        } finally {
            setLoading(false);
        }
    }, [onPromptsChange]);

    useEffect(() => {
        if (open && !loadedRef.current) {
            loadedRef.current = true;
            void loadPrompts();
        }
    }, [open, loadPrompts]);

    /**
     * Whether any prompt carries an enabled trigger (cron or hook — hook runs
     * also write `lastRunAt`). Drives the run-refresh poll gate so an
     * all-manual list never polls the backend.
     */
    const hasActiveSchedule = prompts.some(
        sp => (sp.triggers ?? []).some(trigger => trigger.enabled)
    );

    // Advance `now` once a second while the panel is open so the next-run
    // countdown and the last-run relative labels update on their own. The
    // interval is the only writer, torn down on close/unmount.
    useEffect(() => {
        if (!open) {
            return;
        }
        setNow(Date.now());
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(id);
    }, [open]);

    // Refetch the prompt list while the panel is open and a schedule is live, so
    // a backend-written `lastRunAt` surfaces without a manual refresh. Gated on
    // `hasActiveSchedule` (a primitive, so the effect re-subscribes only when the
    // gate flips, not on every list refresh) to keep an all-manual list quiet.
    useEffect(() => {
        if (!open || !hasActiveSchedule) {
            return;
        }
        const id = setInterval(() => {
            // Silent background refresh: hit the API directly and replace the
            // list without toggling `loading`, so the open panel never flashes to
            // the "Loading…" placeholder mid-view every 30s. Errors are swallowed
            // — the next tick retries — matching loadPrompts' silent-failure stance.
            listSavedPrompts()
                .then(onPromptsChange)
                .catch(() => {});
        }, RUN_REFRESH_MS);
        return () => clearInterval(id);
    }, [open, hasActiveSchedule, onPromptsChange]);

    /** Persist a new prompt with the current composer text. */
    const handleSave = useCallback(async () => {
        const trimmedName = saveName.trim();
        const trimmedPrompt = currentPromptText.trim();
        if (!trimmedName || !trimmedPrompt) {
            return;
        }
        try {
            onPromptsChange(await saveSavedPrompt({ name: trimmedName, prompt: trimmedPrompt }));
            setSaveName('');
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to save prompt');
        }
    }, [saveName, currentPromptText, onPromptsChange, onError]);

    /** Duplicate an existing prompt with an auto-suffixed name. */
    const handleDuplicate = useCallback(async (sp: ISavedPrompt) => {
        // Compare lowercased: the backend's unique-name index is collation
        // strength-2 (case-insensitive), so a case-variant match must count as a
        // collision here too, otherwise the save round-trips to a 409.
        const existingNames = new Set(prompts.map(p => p.name.toLowerCase()));
        let candidate = `${sp.name} (copy)`;
        let counter = 2;
        while (existingNames.has(candidate.toLowerCase())) {
            candidate = `${sp.name} (copy ${counter})`;
            counter += 1;
        }
        try {
            onPromptsChange(await saveSavedPrompt({ name: candidate, prompt: sp.prompt }));
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to duplicate prompt');
        }
    }, [prompts, onPromptsChange, onError]);

    /** Delete a prompt by id (called from the confirm modal). */
    const handleDelete = useCallback(async (id: string) => {
        try {
            await deleteSavedPrompt(id);
            onPromptsChange(prompts.filter(p => p.id !== id));
        } catch (err) {
            onError(err instanceof Error ? err.message : 'Failed to delete prompt');
        }
    }, [prompts, onPromptsChange, onError]);

    /** Open the focused editor (name / body / tools / triggers) for a prompt. */
    const openEdit = useCallback((sp: ISavedPrompt) => {
        modal.open({
            title: 'Edit prompt',
            size: 'md',
            dismissible: true,
            content: (
                <PromptEditModal
                    prompt={sp}
                    onSaved={onPromptsChange}
                    onError={onError}
                />
            )
        });
    }, [modal, onPromptsChange, onError]);

    /** Confirm before deleting, warning when active or paused triggers are attached. */
    const confirmDelete = useCallback((sp: ISavedPrompt) => {
        const triggers = sp.triggers ?? [];
        const hasSchedule = triggers.length > 0;
        const scheduleIsActive = triggers.some(trigger => trigger.enabled);
        const modalId = modal.open({
            title: 'Delete saved prompt?',
            size: 'sm',
            dismissible: true,
            content: (
                <div className={styles.confirm}>
                    <p className={styles.confirm_text}>
                        Delete <strong>{sp.name}</strong>? This cannot be undone.
                    </p>
                    {scheduleIsActive && (
                        <p className={styles.confirm_warning}>
                            <AlertTriangle size={14} /> Active triggers will stop firing.
                        </p>
                    )}
                    {hasSchedule && !scheduleIsActive && (
                        <p className={styles.confirm_warning}>
                            <AlertTriangle size={14} /> Paused triggers will be removed with the prompt.
                        </p>
                    )}
                    <div className={styles.confirm_actions}>
                        <Button variant="ghost" size="xs" onClick={() => modal.close(modalId)}>
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            size="xs"
                            onClick={() => { modal.close(modalId); void handleDelete(sp.id); }}
                        >
                            <Trash2 size={12} /> Delete
                        </Button>
                    </div>
                </div>
            )
        });
    }, [modal, handleDelete]);

    /**
     * Triggers chip for a row — always clickable so a row with no triggers
     * still jumps into the editor to add one.
     *
     * @param sp - The prompt whose triggers to render.
     * @returns The chip element.
     */
    function renderTriggersChip(sp: ISavedPrompt) {
        const triggers = sp.triggers ?? [];
        const anyEnabled = triggers.some(trigger => trigger.enabled);
        const summary = describeTriggers(triggers);
        const titleText = summary
            ? `${summary}${anyEnabled ? '' : ' (paused)'}`
            : 'No triggers — click to add';
        const chipClass = [
            styles.schedule_chip,
            triggers.length > 0 && anyEnabled ? styles.schedule_chip_active : '',
            triggers.length > 0 && !anyEnabled ? styles.schedule_chip_paused : ''
        ].filter(Boolean).join(' ');

        return (
            <button
                type="button"
                className={chipClass}
                onClick={() => openEdit(sp)}
                title={titleText}
                aria-label={`Edit triggers for ${sp.name}`}
            >
                <CalendarClock size={12} />
                {summary && (
                    <span className={styles.schedule_chip_text}>
                        {summary}
                        {!anyEnabled && ' (paused)'}
                    </span>
                )}
            </button>
        );
    }

    /**
     * Panel body: loading, empty, or the list of prompts.
     *
     * @returns The body content.
     */
    function renderBody() {
        if (loading) {
            return (
                <div className={styles.loading}>
                    <RefreshCw size={14} className={styles.spinning} /> Loading…
                </div>
            );
        }
        if (prompts.length === 0) {
            return <div className={styles.empty}>No saved prompts yet.</div>;
        }
        return (
            <ul className={styles.list}>
                {prompts.map(sp => {
                    // Next-run only applies to enabled cron triggers — a paused
                    // trigger never fires and a hook trigger has no predictable
                    // firing time, so promising a "next run" there would mislead.
                    // `now` is ticked each second while open, so this re-derives
                    // and the countdown advances on its own.
                    const triggers = sp.triggers ?? [];
                    const nextRunMs = msUntilNextRun(triggers, now);
                    const lastRun = latestRunAt(triggers);
                    const hasRunError = triggers.some(trigger => !!trigger.lastRunError);
                    return (
                    <li key={sp.id} className={`${styles.row} ${hasRunError ? styles.row_error : ''}`}>
                        <div className={styles.row_main}>
                            <button
                                type="button"
                                className={styles.row_name}
                                onClick={() => onLoadPromptText(sp.prompt)}
                                title={sp.prompt}
                                aria-label={`Load prompt: ${sp.name}`}
                            >
                                {sp.name}
                            </button>
                            <div className={styles.row_meta}>
                                {/* Last run always shows — including for a prompt with no
                                    active trigger — so an operator can see when a prompt
                                    last fired regardless of whether anything is currently
                                    enabled; "Never run yet" covers the not-yet-fired case.
                                    Next run shows only for a live cron trigger. */}
                                {lastRun
                                    ? <span>Last run {formatRelativeTime(lastRun)}</span>
                                    : <span>Never run yet</span>}
                                {nextRunMs !== null && <span>Next run {formatTimeUntil(nextRunMs)}</span>}
                            </div>
                        </div>
                        <div className={styles.row_actions}>
                            {renderTriggersChip(sp)}
                            <IconButton
                                variant="primary"
                                size="sm"
                                onClick={() => onRun(sp)}
                                aria-label={`Run ${sp.name} now`}
                                title="Run this prompt now (autonomous — result appears in History)"
                            >
                                <Play size={12} />
                            </IconButton>
                            <IconButton
                                variant="primary"
                                size="sm"
                                onClick={() => openEdit(sp)}
                                aria-label={`Edit ${sp.name}`}
                                title="Edit name, body, tools, and triggers"
                            >
                                <Pencil size={12} />
                            </IconButton>
                            <IconButton
                                variant="primary"
                                size="sm"
                                onClick={() => { void handleDuplicate(sp); }}
                                aria-label={`Duplicate ${sp.name}`}
                                title="Duplicate this prompt"
                            >
                                <CopyPlus size={12} />
                            </IconButton>
                            <IconButton
                                variant="danger"
                                size="sm"
                                onClick={() => confirmDelete(sp)}
                                aria-label={`Delete ${sp.name}`}
                            >
                                <Trash2 size={12} />
                            </IconButton>
                        </div>
                    </li>
                    );
                })}
            </ul>
        );
    }

    return (
        <CollapsibleSection
            title="Saved Prompts"
            icon={<Bookmark size={16} className={styles.panel_icon} />}
            summary={prompts.length > 0 ? <span className={styles.panel_count}>{prompts.length}</span> : undefined}
            open={open}
            onToggle={setOpen}
        >
            <Stack gap="sm">
                <div className={styles.save_row}>
                    <Input
                        type="text"
                        value={saveName}
                        onChange={(e) => setSaveName(e.target.value)}
                        placeholder="Prompt name…"
                        className={styles.name_input}
                        aria-label="Prompt name"
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') {
                                e.preventDefault();
                                void handleSave();
                            }
                        }}
                    />
                    <Button
                        variant="primary"
                        size="xs"
                        onClick={() => { void handleSave(); }}
                        disabled={!saveName.trim() || !currentPromptText.trim()}
                        aria-label="Save current prompt"
                    >
                        Save
                    </Button>
                </div>
                {renderBody()}
            </Stack>
        </CollapsibleSection>
    );
}
