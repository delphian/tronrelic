'use client';

/**
 * @file PromptEditorBar.tsx
 *
 * The strip under the Conversation header that appears once a saved prompt is
 * loaded (or a new one is being written). It carries everything the retired
 * saved-prompts panel used to spread across a row of its own: the name field,
 * the unsaved-changes indicator, the single Save, run-now, duplicate, delete,
 * and the toggle that reveals the triggers editor — plus the live "last run /
 * next run" status the panel used to show per row.
 *
 * The single Save is the point. Because the composer textarea *is* the prompt
 * body, an operator edits body, model, tools, and triggers in one surface, and
 * one write covers all of them. The unsaved dot is therefore the only signal
 * that what a schedule would fire has diverged from what is on screen, which is
 * why the parent computes it across every field rather than per section.
 *
 * A client-only admin surface, rendered only after a user action, so the
 * per-second tick driving the countdown carries no SSR hydration concern.
 */

import { useState, useEffect } from 'react';
import { Save, Play, CopyPlus, Trash2, CalendarClock, X, AlertCircle } from 'lucide-react';
import type { ISavedPrompt } from '@/types';
import { Input } from '../../../../../components/ui/Input';
import { Button } from '../../../../../components/ui/Button';
import { IconButton } from '../../../../../components/ui/IconButton';
import { latestRunAt, msUntilNextRun } from './savedPromptDraft';
import { formatRelativeTime, formatTimeUntil } from './savedPromptCron';
import styles from './PromptEditor.module.scss';

/**
 * How often (ms) the bar re-renders so the "next run" countdown and the
 * "last run … ago" label advance without a manual refresh. One second keeps the
 * sub-minute countdown smooth, and the work is a cheap re-render of one row.
 */
const TICK_MS = 1000;

interface PromptEditorBarProps {
    /** The stored prompt being edited, or null while writing an unsaved new one. */
    prompt: ISavedPrompt | null;
    /** The name field's current value. */
    name: string;
    /** Receives each keystroke in the name field. */
    onNameChange: (name: string) => void;
    /** Whether the editor holds changes the stored prompt does not have yet. */
    dirty: boolean;
    /** Whether a save is in flight. */
    saving: boolean;
    /**
     * Why Save is unavailable, or null when it is available. Rendered as the
     * button's tooltip so a disabled Save always explains itself — an invalid
     * cron three sections away is otherwise invisible from up here.
     */
    saveBlockedReason: string | null;
    /** Persist name, body, model pin, tool allowlist, and triggers in one write. */
    onSave: () => void;
    /**
     * Why Run is unavailable, or null when it can fire. Separate from `dirty`
     * because the reason has to be *shown*: Run executes the stored document
     * server-side, so with unsaved edits on screen it would run text the operator
     * is looking at a replacement for.
     */
    runBlockedReason: string | null;
    /** Execute the prompt now as a self-contained autonomous run. */
    onRun: () => void;
    /** Copy the prompt under an auto-suffixed name. */
    onDuplicate: () => void;
    /** Delete the prompt (the parent confirms first). */
    onDelete: () => void;
    /** Stop editing: clears the bar without touching the transcript. */
    onClose: () => void;
    /** Whether the triggers editor is revealed below the composer. */
    triggersOpen: boolean;
    /** Toggle the triggers editor. */
    onToggleTriggers: () => void;
    /** How many trigger rows are currently drafted, for the toggle's count. */
    triggerCount: number;
}

/**
 * The loaded-prompt control strip.
 *
 * @param props - See {@link PromptEditorBarProps}.
 * @returns The bar.
 */
export function PromptEditorBar({
    prompt,
    name,
    onNameChange,
    dirty,
    saving,
    saveBlockedReason,
    onSave,
    runBlockedReason,
    onRun,
    onDuplicate,
    onDelete,
    onClose,
    triggersOpen,
    onToggleTriggers,
    triggerCount
}: PromptEditorBarProps) {
    /**
     * Wall-clock backing the live status labels. Ticked here rather than in the
     * parent so a countdown that only this strip renders cannot re-render the
     * whole chat transcript once a second.
     */
    const [now, setNow] = useState(() => Date.now());

    useEffect(() => {
        const id = setInterval(() => setNow(Date.now()), TICK_MS);
        return () => clearInterval(id);
    }, []);

    const triggers = prompt?.triggers ?? [];
    const lastRun = latestRunAt(triggers);
    const nextRunMs = msUntilNextRun(triggers, now);
    const runError = triggers.find(trigger => trigger.lastRunError)?.lastRunError ?? null;

    return (
        <div className={`${styles.bar} ${runError ? styles.bar_error : ''}`}>
            <div className={styles.bar_row}>
                <Input
                    type="text"
                    value={name}
                    onChange={(e) => onNameChange(e.target.value)}
                    placeholder="Prompt name…"
                    className={styles.name_input}
                    aria-label="Saved prompt name"
                />

                {dirty && (
                    <span className={styles.dirty} title="Unsaved changes in this editor">
                        <span className={styles.dirty_dot} aria-hidden="true" />
                        unsaved
                    </span>
                )}

                <div className={styles.bar_actions}>
                    <Button
                        variant="primary"
                        size="xs"
                        onClick={onSave}
                        disabled={saving || saveBlockedReason !== null}
                        title={saveBlockedReason ?? 'Save name, prompt text, model, tools, and triggers'}
                    >
                        <Save size={12} /> {saving ? 'Saving…' : 'Save prompt'}
                    </Button>

                    <button
                        type="button"
                        className={`${styles.triggers_toggle} ${triggersOpen ? styles.triggers_toggle_open : ''}`}
                        onClick={onToggleTriggers}
                        aria-expanded={triggersOpen}
                        title={prompt
                            ? 'Cron schedules and hook bindings that fire this prompt autonomously'
                            : 'Add triggers — they save with the prompt'}
                    >
                        <CalendarClock size={12} />
                        <span>
                            Triggers
                            {triggerCount > 0 && ` (${triggerCount})`}
                        </span>
                    </button>

                    {/* Run / duplicate / delete act on the stored document, so they
                        stay hidden until the prompt has actually been saved once. */}
                    {prompt && (
                        <>
                            <IconButton
                                variant="primary"
                                size="sm"
                                onClick={onRun}
                                disabled={runBlockedReason !== null}
                                aria-label={`Run ${prompt.name} now`}
                                title={runBlockedReason ?? 'Run this prompt now (autonomous — result appears in History)'}
                            >
                                <Play size={12} />
                            </IconButton>
                            <IconButton
                                variant="primary"
                                size="sm"
                                onClick={onDuplicate}
                                aria-label={`Duplicate ${prompt.name}`}
                                title="Duplicate this prompt"
                            >
                                <CopyPlus size={12} />
                            </IconButton>
                            <IconButton
                                variant="danger"
                                size="sm"
                                onClick={onDelete}
                                aria-label={`Delete ${prompt.name}`}
                                title="Delete this prompt"
                            >
                                <Trash2 size={12} />
                            </IconButton>
                        </>
                    )}

                    <IconButton
                        variant="ghost"
                        size="sm"
                        onClick={onClose}
                        aria-label="Stop editing this prompt"
                        title="Stop editing — leaves the conversation untouched"
                    >
                        <X size={12} />
                    </IconButton>
                </div>
            </div>

            <div className={styles.bar_meta}>
                {prompt
                    ? <span>{lastRun ? `Last run ${formatRelativeTime(lastRun)}` : 'Never run yet'}</span>
                    : <span>Not saved yet — Save creates it.</span>}
                {nextRunMs !== null && <span>Next run {formatTimeUntil(nextRunMs)}</span>}
                {runError && (
                    <span className={styles.bar_meta_error}>
                        <AlertCircle size={11} /> {runError}
                    </span>
                )}
                <span className={styles.bar_meta_hint}>
                    The composer below holds this prompt&apos;s text.
                </span>
            </div>
        </div>
    );
}
