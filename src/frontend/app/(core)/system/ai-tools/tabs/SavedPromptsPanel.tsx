'use client';

/**
 * @file SavedPromptsPanel.tsx
 *
 * Collapsible saved-prompts panel for the Query tab. Lists saved prompt
 * templates with per-row load (click the name to drop it into the composer),
 * duplicate, edit, and delete, plus an inline save row that captures the
 * composer's current text. Each row shows a schedule chip linking to the cron
 * editor (rendered in a modal). The parent owns the shared `prompts` list so the
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
    ChevronDown,
    ChevronRight,
    RefreshCw,
    Pencil,
    CopyPlus,
    Trash2,
    CalendarClock,
    AlertTriangle
} from 'lucide-react';
import type { ISavedPrompt } from '@/types';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { IconButton } from '../../../../../components/ui/IconButton';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { listSavedPrompts, saveSavedPrompt, deleteSavedPrompt } from '../../../../../modules/ai-tools';
import { describeCron, formatRelativeTime } from './savedPromptCron';
import { PromptEditModal } from './PromptEditModal';
import styles from './SavedPromptsPanel.module.scss';

interface SavedPromptsPanelProps {
    /** Shared saved-prompts list, owned by the parent Query tab. */
    prompts: ISavedPrompt[];
    /** Replace the shared list after a panel action (no refetch needed). */
    onPromptsChange: (prompts: ISavedPrompt[]) => void;
    /** Current composer text — captured by the inline Save row. */
    currentPromptText: string;
    /** Load a saved prompt's body back into the composer. */
    onLoadPromptText: (text: string) => void;
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
    onError
}: SavedPromptsPanelProps) {
    const modal = useModal();
    const [open, setOpen] = useState(false);
    const [loading, setLoading] = useState(false);
    const [saveName, setSaveName] = useState('');
    const loadedRef = useRef(false);

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

    /** Open the focused editor (name / body / schedule) for a prompt. */
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

    /** Confirm before deleting, warning when an active or paused schedule is attached. */
    const confirmDelete = useCallback((sp: ISavedPrompt) => {
        const hasSchedule = !!sp.cron && sp.cron.trim().length > 0;
        const scheduleIsActive = hasSchedule && sp.scheduleEnabled !== false;
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
                            <AlertTriangle size={14} /> An active schedule will stop firing.
                        </p>
                    )}
                    {hasSchedule && !scheduleIsActive && (
                        <p className={styles.confirm_warning}>
                            <AlertTriangle size={14} /> A paused schedule will be removed with the prompt.
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
     * Schedule chip for a row — always clickable so a row with no cron still
     * jumps into the editor to add one.
     *
     * @param sp - The prompt whose schedule to render.
     * @returns The chip element.
     */
    function renderScheduleChip(sp: ISavedPrompt) {
        const hasCron = !!sp.cron && sp.cron.trim().length > 0;
        const scheduleEnabled = sp.scheduleEnabled !== false;
        const cronDescription = hasCron ? describeCron(sp.cron as string) : null;
        const titleText = hasCron
            ? `${cronDescription ?? sp.cron ?? ''}${scheduleEnabled ? '' : ' (paused)'}`
            : 'No schedule — click to add';
        const chipClass = [
            styles.schedule_chip,
            hasCron && scheduleEnabled ? styles.schedule_chip_active : '',
            hasCron && !scheduleEnabled ? styles.schedule_chip_paused : ''
        ].filter(Boolean).join(' ');

        return (
            <button
                type="button"
                className={chipClass}
                onClick={() => openEdit(sp)}
                title={titleText}
                aria-label={`Edit schedule for ${sp.name}`}
            >
                <CalendarClock size={12} />
                {hasCron && (
                    <span className={styles.schedule_chip_text}>
                        {cronDescription ?? 'invalid cron'}
                        {!scheduleEnabled && ' (paused)'}
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
                {prompts.map(sp => (
                    <li key={sp.id} className={`${styles.row} ${sp.lastRunError ? styles.row_error : ''}`}>
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
                                {renderScheduleChip(sp)}
                                {sp.lastRunAt && <span>Last run {formatRelativeTime(sp.lastRunAt)}</span>}
                            </div>
                        </div>
                        <div className={styles.row_actions}>
                            <IconButton
                                variant="primary"
                                size="sm"
                                onClick={() => openEdit(sp)}
                                aria-label={`Edit ${sp.name}`}
                                title="Edit name, body, and schedule"
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
                ))}
            </ul>
        );
    }

    return (
        <Card className={styles.panel_card}>
            <button
                type="button"
                className={styles.panel_toggle}
                onClick={() => setOpen(!open)}
                aria-expanded={open}
                aria-label="Toggle saved prompts panel"
            >
                <Bookmark size={16} className={styles.panel_icon} />
                <span>Saved Prompts</span>
                {prompts.length > 0 && <span className={styles.panel_count}>{prompts.length}</span>}
                {open
                    ? <ChevronDown size={14} className={styles.panel_chevron} />
                    : <ChevronRight size={14} className={styles.panel_chevron} />}
            </button>

            {open && (
                <div className={styles.panel_body}>
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
                </div>
            )}
        </Card>
    );
}
