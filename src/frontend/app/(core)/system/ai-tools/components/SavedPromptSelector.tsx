'use client';

/**
 * @file SavedPromptSelector.tsx
 *
 * The saved-prompt library, collapsed into a single dropdown that sits beside
 * the "Conversation" header label. It replaces the standalone Saved Prompts
 * panel that used to hang below the chat card: the Conversation card is now the
 * prompt editor, so the library only has to answer "which prompt am I editing?"
 * — every action on a prompt lives in the prompt bar once one is loaded.
 *
 * The panel renders into a `<body>` portal rather than inline. The chat card
 * clips its overflow to keep the transcript scrolling inside rounded corners, so
 * a panel anchored inside the header would be cut off at the card edge. A portal
 * escapes that clipping and any ancestor stacking context, at the cost of having
 * to place the panel by hand *and* manage focus by hand — the same trade
 * `ToolAllowlistDropdown` makes in the composer below, and the placement and
 * focus handling here deliberately mirror it.
 *
 * A pure client surface on an admin dashboard: the list arrives as a prop from
 * the parent (which owns fetching and the schedule-refresh poll), and the
 * relative-time labels only render inside the opened panel — never during SSR —
 * so there is no hydration concern.
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Bookmark, ChevronDown, CalendarClock, Plus, AlertCircle } from 'lucide-react';
import type { ISavedPrompt } from '@/types';
import { describeTriggers, latestRunAt } from '../tabs/savedPromptDraft';
import { formatRelativeTime } from '../tabs/savedPromptCron';
import styles from './SavedPromptSelector.module.scss';

/** Space (px) between the trigger and the panel, and the minimum viewport inset. */
const PANEL_GAP_PX = 4;

/** Floor (px) for the panel height when neither side of the trigger has room. */
const MIN_PANEL_HEIGHT_PX = 180;

/** Preferred panel width (px) — wide enough that prompt names rarely truncate. */
const PREFERRED_PANEL_WIDTH_PX = 380;

/** Resolved viewport-fixed geometry for the portaled panel. */
interface IPanelPosition {
    top: number;
    left: number;
    width: number;
    maxHeight: number;
}

interface SavedPromptSelectorProps {
    /** Every saved prompt, newest-updated first. */
    prompts: ISavedPrompt[];
    /** Id of the prompt currently loaded into the Conversation card, or null. */
    loadedPromptId: string | null;
    /** Load a prompt: starts a new chat and fills the composer, model, and tools. */
    onSelect: (prompt: ISavedPrompt) => void;
    /** Begin a new prompt from whatever is currently in the composer. */
    onCreateNew: () => void;
    /** Disable the trigger while a send is in flight (loading would discard the stream). */
    disabled?: boolean;
}

/**
 * Dropdown listing every saved prompt, plus the entry that starts a new one.
 *
 * @param props - See {@link SavedPromptSelectorProps}.
 * @returns The selector.
 */
export function SavedPromptSelector({
    prompts,
    loadedPromptId,
    onSelect,
    onCreateNew,
    disabled = false
}: SavedPromptSelectorProps) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<IPanelPosition | null>(null);
    const panelId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    /**
     * Whether focus has already been handed to the panel for this opening. The
     * panel is repositioned on every scroll and resize, so without this latch the
     * focus effect would yank focus back to the container each time the operator
     * scrolled the list.
     */
    const focusMovedRef = useRef(false);

    // A disabled trigger must not leave an orphaned panel floating over the card.
    useEffect(() => {
        if (disabled) {
            setOpen(false);
        }
    }, [disabled]);

    // Dismiss on an outside click. The panel is portaled to `<body>` and so is
    // not a descendant of the trigger: both nodes have to be tested, or the
    // mousedown beginning a click on a row would close the panel before that
    // row's own handler ran.
    useEffect(() => {
        if (!open) {
            return;
        }
        const handlePointerDown = (event: MouseEvent): void => {
            const target = event.target as Node;
            const inside = Boolean(triggerRef.current?.contains(target))
                || Boolean(panelRef.current?.contains(target));
            if (!inside) {
                setOpen(false);
            }
        };
        document.addEventListener('mousedown', handlePointerDown);
        return () => document.removeEventListener('mousedown', handlePointerDown);
    }, [open]);

    // Escape closes and hands focus back to the trigger, so a keyboard user is
    // never stranded in a dismissed overlay.
    useEffect(() => {
        if (!open) {
            return;
        }
        const handleKeyDown = (event: KeyboardEvent): void => {
            if (event.key === 'Escape') {
                setOpen(false);
                triggerRef.current?.focus();
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [open]);

    /*
     * Place the portaled panel against its trigger. A fixed element does not
     * follow its anchor, so the position is measured here and re-measured on
     * scroll (captured, so scrolling an inner container counts) and on resize.
     * Runs as a layout effect so coordinates are set before paint — otherwise the
     * panel flashes at the viewport origin.
     *
     * Unlike the composer's tools dropdown this anchor sits at the *top* of the
     * card, so the panel normally opens downward; the same both-directions logic
     * is kept anyway, because the dashboard can be scrolled to any position and a
     * long prompt list can outgrow the space below.
     */
    useLayoutEffect(() => {
        if (!open) {
            setPosition(null);
            return undefined;
        }
        function updatePosition(): void {
            const anchor = triggerRef.current;
            const panel = panelRef.current;
            if (!anchor || !panel) {
                return;
            }
            const anchorRect = anchor.getBoundingClientRect();
            const viewportHeight = document.documentElement.clientHeight;
            const viewportWidth = document.documentElement.clientWidth;
            // Pin the width before reading the height: on the first pass the
            // portaled panel shrink-to-fits, so a height measured then is not the
            // height it will actually have once React writes the same width.
            const width = Math.min(
                Math.max(PREFERRED_PANEL_WIDTH_PX, anchorRect.width),
                viewportWidth - PANEL_GAP_PX * 2
            );
            panel.style.width = `${width}px`;
            // `scrollHeight` is the natural content height. The rendered height is
            // already clamped by the maxHeight this effect applied, so feeding it
            // back would flip the direction on alternate passes.
            const naturalHeight = panel.scrollHeight;
            const spaceBelow = viewportHeight - anchorRect.bottom - PANEL_GAP_PX * 2;
            const spaceAbove = anchorRect.top - PANEL_GAP_PX * 2;
            const openAbove = naturalHeight > spaceBelow && spaceAbove > spaceBelow;
            const maxHeight = Math.max(MIN_PANEL_HEIGHT_PX, openAbove ? spaceAbove : spaceBelow);
            const height = Math.min(naturalHeight, maxHeight);
            const preferredTop = openAbove
                ? anchorRect.top - PANEL_GAP_PX - height
                : anchorRect.bottom + PANEL_GAP_PX;
            const top = Math.max(
                PANEL_GAP_PX,
                Math.min(preferredTop, viewportHeight - height - PANEL_GAP_PX)
            );
            const left = Math.max(
                PANEL_GAP_PX,
                Math.min(anchorRect.left, viewportWidth - width - PANEL_GAP_PX)
            );
            setPosition({ top, left, width, maxHeight });
        }
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [open, prompts]);

    /*
     * Hand focus to the panel once it is open and placed. Portaling moves the
     * rows to the end of `<body>`, so Tab from the trigger would walk the entire
     * chat card before reaching one — the panel has to claim focus itself or the
     * control is mouse-only. Focus lands on the panel container rather than the
     * first row, so opening never reads as having pre-selected a prompt.
     *
     * Deferred until `position` resolves: until then the panel renders
     * `visibility: hidden` to avoid a flash at the viewport origin, and a hidden
     * element cannot take focus.
     */
    useLayoutEffect(() => {
        if (!open) {
            focusMovedRef.current = false;
            return;
        }
        if (position && !focusMovedRef.current) {
            focusMovedRef.current = true;
            panelRef.current?.focus();
        }
    }, [open, position]);

    /**
     * Rove focus across the panel's rows with the arrow keys, mirroring the
     * composer's tools dropdown. Enter and Space activate natively (the rows are
     * real buttons) and Escape is already bound globally, so only the vertical
     * traversal is missing — without it a keyboard operator would have to Tab
     * blindly out of the document flow to reach the list.
     *
     * @param event - Key event bubbling up from the panel or one of its rows.
     */
    const handlePanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }
        // Suppress the page scroll the arrow keys would otherwise cause while
        // focus is parked on the panel container.
        event.preventDefault();
        const options = panelRef.current
            ? Array.from(panelRef.current.querySelectorAll<HTMLElement>('button:not([disabled])'))
            : [];
        if (options.length === 0) {
            return;
        }
        const current = options.indexOf(document.activeElement as HTMLElement);
        const next = current === -1
            ? (event.key === 'ArrowDown' ? 0 : options.length - 1)
            : (current + (event.key === 'ArrowDown' ? 1 : -1) + options.length) % options.length;
        options[next].focus();
    }, []);

    /**
     * Load a prompt and dismiss the panel. Closing here rather than in the parent
     * keeps the selector self-contained: the parent's job is to apply the prompt,
     * not to remember to shut the menu that asked for it.
     *
     * @param prompt - The prompt the operator picked.
     */
    const handleSelect = useCallback((prompt: ISavedPrompt) => {
        setOpen(false);
        onSelect(prompt);
    }, [onSelect]);

    /** Start a new prompt from the composer's current text and dismiss the panel. */
    const handleCreateNew = useCallback(() => {
        setOpen(false);
        onCreateNew();
    }, [onCreateNew]);

    const loadedPrompt = prompts.find(prompt => prompt.id === loadedPromptId) ?? null;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={`${styles.trigger} ${loadedPrompt ? styles.trigger_loaded : ''}`}
                onClick={() => setOpen(value => !value)}
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                title={loadedPrompt
                    ? `Editing the saved prompt "${loadedPrompt.name}" — pick another to switch`
                    : 'Load a saved prompt into this conversation'}
            >
                <Bookmark size={14} />
                <span className={styles.trigger_label}>{loadedPrompt ? loadedPrompt.name : 'Saved prompts'}</span>
                {prompts.length > 0 && !loadedPrompt && (
                    <span className={styles.trigger_count}>{prompts.length}</span>
                )}
                <ChevronDown size={14} className={styles.trigger_caret} aria-hidden="true" />
            </button>

            {open && createPortal(
                <div
                    ref={panelRef}
                    id={panelId}
                    role="dialog"
                    aria-label="Saved prompts"
                    className={styles.panel}
                    // Focusable only programmatically: the panel accepts focus on
                    // open so the rows are reachable, but never joins the tab order
                    // itself at the end of `<body>`.
                    tabIndex={-1}
                    onKeyDown={handlePanelKeyDown}
                    style={position
                        ? { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }
                        : { visibility: 'hidden' }}
                >
                    <button type="button" className={styles.create_row} onClick={handleCreateNew}>
                        <Plus size={14} />
                        <span>New prompt from composer</span>
                    </button>

                    <div className={styles.separator} role="presentation" />

                    {prompts.length === 0 ? (
                        <p className={styles.empty}>
                            No saved prompts yet. Write one in the composer, then use “New prompt from composer”.
                        </p>
                    ) : (
                        <ul className={styles.list}>
                            {prompts.map(prompt => {
                                const triggers = prompt.triggers ?? [];
                                const summary = describeTriggers(triggers);
                                const anyEnabled = triggers.some(trigger => trigger.enabled);
                                const hasRunError = triggers.some(trigger => !!trigger.lastRunError);
                                const lastRun = latestRunAt(triggers);
                                const isLoaded = prompt.id === loadedPromptId;
                                return (
                                    <li key={prompt.id}>
                                        <button
                                            type="button"
                                            className={`${styles.row} ${isLoaded ? styles.row_loaded : ''}`}
                                            onClick={() => handleSelect(prompt)}
                                            aria-current={isLoaded ? 'true' : undefined}
                                        >
                                            <span className={styles.row_main}>
                                                <span className={styles.row_name}>{prompt.name}</span>
                                                <span className={styles.row_meta}>
                                                    <span>{lastRun ? `Last run ${formatRelativeTime(lastRun)}` : 'Never run yet'}</span>
                                                    {hasRunError && (
                                                        <span className={styles.row_error}>
                                                            <AlertCircle size={11} /> last run failed
                                                        </span>
                                                    )}
                                                </span>
                                            </span>
                                            {summary && (
                                                <span
                                                    className={`${styles.row_chip} ${anyEnabled ? styles.row_chip_active : styles.row_chip_paused}`}
                                                    title={`${summary}${anyEnabled ? '' : ' (paused)'}`}
                                                >
                                                    <CalendarClock size={11} />
                                                    <span className={styles.row_chip_text}>
                                                        {summary}
                                                        {!anyEnabled && ' (paused)'}
                                                    </span>
                                                </span>
                                            )}
                                        </button>
                                    </li>
                                );
                            })}
                        </ul>
                    )}
                </div>,
                document.body
            )}
        </>
    );
}
