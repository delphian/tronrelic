'use client';

/**
 * @file ToolAllowlistDropdown.tsx
 *
 * The Query composer's per-run tool grant, as a dropdown that sits in the
 * toolbar beside the model picker. Both controls answer the same question —
 * "how does the next message run?" — so they belong together on one line, and
 * the grant stays a deliberate act rather than an expanded panel that pushes the
 * composer around every time an operator looks at it.
 *
 * The panel renders into a `<body>` portal rather than inline. The chat card
 * clips its overflow to keep the transcript scrolling inside rounded corners, so
 * a panel anchored inside the composer would be cut off at the card edge. A
 * portal escapes that clipping and any ancestor stacking context, at the cost of
 * having to place the panel by hand *and* to manage focus by hand — the same
 * trade `AddressSelector` and `TronAddress` already make, and both the placement
 * and the focus handling here mirror theirs.
 *
 * Selection state, persistence, and the trifecta preview all live with the
 * parent; this component owns only its open/closed state, its geometry, and the
 * keyboard access the portal would otherwise cost.
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Wrench, ChevronDown } from 'lucide-react';
import type { IAiToolInfo, ITrifectaStatus } from '@/types';
import { ToolAllowlistPicker } from './ToolAllowlistPicker';
import { RunTrifectaBadge } from './RunTrifectaBadge';
import styles from './ToolAllowlistDropdown.module.scss';

/** Space (px) between the trigger and the panel, and the minimum viewport inset. */
const PANEL_GAP_PX = 4;

/** Floor (px) for the panel height when neither side of the trigger has room. */
const MIN_PANEL_HEIGHT_PX = 180;

/** Preferred panel width (px) — wide enough that tool names do not wrap. */
const PREFERRED_PANEL_WIDTH_PX = 340;

/** Resolved viewport-fixed geometry for the portaled panel. */
interface IPanelPosition {
    top: number;
    left: number;
    width: number;
    maxHeight: number;
}

interface ToolAllowlistDropdownProps {
    /** Every registered governed tool (enabled and disabled), for the option list. */
    tools: IAiToolInfo[];
    /**
     * Provider-hosted tools the run could call, for the second option group.
     * Scoped by the parent to the provider and model this run will use, because
     * those switches are stored per model.
     */
    hostedTools: IAiToolInfo[];
    /** Currently-granted allowlist entries, hosted ones carrying the `hosted:` prefix. */
    selected: string[];
    /** Receives the next selection whenever an option toggles. */
    onChange: (names: string[]) => void;
    /** Scoped lethal-trifecta verdict for the selection, or null before the first preview. */
    trifecta: ITrifectaStatus | null;
    /** Whether a trifecta preview is in flight. */
    trifectaLoading: boolean;
    /**
     * Notifies the parent when the panel opens or closes. The parent gates its
     * trifecta preview on this, so an operator who never opens the dropdown
     * costs no preview requests.
     */
    onOpenChange: (open: boolean) => void;
    /** Disable the trigger while a send is in flight. */
    disabled?: boolean;
    /**
     * Overrides the panel's explanatory text. The default describes a one-shot
     * per-message grant, which stops being true once the composer is editing a
     * saved prompt — there the same selection *is* that prompt's persisted
     * allowlist, and telling the operator it defaults to none and applies to one
     * message would be actively wrong.
     */
    hint?: string;
}

/**
 * Panel copy for the ordinary case: a one-shot grant for the next message only.
 * Lives at module scope so the default and the {@link ToolAllowlistDropdownProps.hint}
 * override are obviously the same slot rather than a string buried in the JSX.
 */
const DEFAULT_HINT = 'Tools this query may call. Defaults to none — grant only what this run '
    + 'needs. Provider-hosted tools appear here too, and are granted the same '
    + 'way: unchecked means the request never offers them, so they cannot run. '
    + 'Naming a tool that is disabled or removed fails the run.';

/**
 * Render the tools trigger button and, while open, its portaled option panel.
 *
 * @param props - See {@link ToolAllowlistDropdownProps}.
 * @returns The dropdown.
 */
export function ToolAllowlistDropdown({
    tools,
    hostedTools,
    selected,
    onChange,
    trifecta,
    trifectaLoading,
    onOpenChange,
    disabled = false,
    hint = DEFAULT_HINT
}: ToolAllowlistDropdownProps) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<IPanelPosition | null>(null);
    const panelId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    /**
     * Whether focus has already been handed to the panel for this opening. The
     * panel is repositioned on every scroll and resize, so without this latch
     * the focus effect would yank focus back to the container each time the
     * operator scrolled while ticking checkboxes.
     */
    const focusMovedRef = useRef(false);

    // Keep the parent's view of open/closed in step without making it own the
    // state. Notifying from an effect (rather than inside each setter) means one
    // notification per actual transition, whatever caused it.
    useEffect(() => {
        onOpenChange(open);
    }, [open, onOpenChange]);

    // A disabled trigger must not leave an orphaned panel floating over the
    // composer — a send starting mid-selection closes it.
    useEffect(() => {
        if (disabled) {
            setOpen(false);
        }
    }, [disabled]);

    // Dismiss on an outside click. The panel is portaled to `<body>` and so is
    // not a descendant of the trigger: both nodes have to be tested, or the
    // mousedown beginning a click on a checkbox would close the panel before
    // that checkbox's own handler ran.
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
     * Runs as a layout effect so coordinates are set before paint — otherwise
     * the panel flashes at the viewport origin.
     *
     * The panel opens upward whenever the space below cannot hold it and the
     * space above is roomier, which is the normal case here: the composer sits
     * at the bottom of the chat card. Both axes are clamped into the viewport,
     * because the height floor means the preferred offset can otherwise push a
     * fixed element off an edge no scroll can bring it back from.
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
            // portaled panel shrink-to-fits, so a height measured then is not
            // the height it will actually have once React writes the same width.
            const width = Math.min(
                Math.max(PREFERRED_PANEL_WIDTH_PX, anchorRect.width),
                viewportWidth - PANEL_GAP_PX * 2
            );
            panel.style.width = `${width}px`;
            // `scrollHeight` is the natural content height. The rendered height
            // is already clamped by the maxHeight this effect applied, so
            // feeding it back would flip the direction on alternate passes.
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
    }, [open, tools, hostedTools, selected, trifecta, trifectaLoading, hint]);

    /*
     * Hand focus to the panel once it is open and placed. Portaling moves the
     * options to the end of `<body>`, so Tab from the trigger walks the Send
     * button and the whole saved-prompts panel before it ever reaches a
     * checkbox — the panel has to claim focus itself or the control is
     * mouse-only. Focus lands on the panel container rather than on the first
     * checkbox, so opening the dropdown never reads as having pre-selected an
     * option; from there both Tab and the arrow keys reach the list, because
     * the panel's own children follow it in document order.
     *
     * Deferred until `position` resolves: until then the panel renders
     * `visibility: hidden` to avoid a flash at the viewport origin, and a
     * hidden element cannot take focus.
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
     * Rove focus across the panel's controls with the arrow keys, mirroring
     * `AddressSelector`'s handling of the same portal problem. Enter and Space
     * activate natively (the options are real checkboxes and buttons) and
     * Escape is already bound globally, so only the vertical traversal is
     * missing — without it a keyboard operator would have to Tab blindly out of
     * the document flow to reach the list.
     *
     * @param event - Key event bubbling up from the panel or one of its options.
     */
    const handlePanelKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
        if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') {
            return;
        }
        // Suppress the page scroll the arrow keys would otherwise cause while
        // focus is parked on the panel container.
        event.preventDefault();
        const options = panelRef.current
            ? Array.from(panelRef.current.querySelectorAll<HTMLElement>('input:not([disabled]), button:not([disabled])'))
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

    const label = selected.length === 0 ? 'none' : `${selected.length} selected`;

    return (
        <>
            <button
                ref={triggerRef}
                type="button"
                className={styles.trigger}
                onClick={() => setOpen(value => !value)}
                disabled={disabled}
                aria-haspopup="dialog"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                title="Tools this query may call"
            >
                <Wrench size={16} />
                <span className={styles.trigger_label}>Tools — {label}</span>
                <ChevronDown size={16} className={styles.trigger_caret} aria-hidden="true" />
            </button>

            {open && createPortal(
                <div
                    ref={panelRef}
                    id={panelId}
                    role="dialog"
                    aria-label="Tools for the next message"
                    className={styles.panel}
                    // Focusable only programmatically: the panel accepts focus on
                    // open so the options are reachable, but never joins the tab
                    // order itself at the end of `<body>`.
                    tabIndex={-1}
                    onKeyDown={handlePanelKeyDown}
                    style={position
                        ? { top: position.top, left: position.left, width: position.width, maxHeight: position.maxHeight }
                        : { visibility: 'hidden' }}
                >
                    <p className={styles.hint}>{hint}</p>
                    <ToolAllowlistPicker
                        tools={tools}
                        hostedTools={hostedTools}
                        selected={selected}
                        onChange={onChange}
                    />
                    <RunTrifectaBadge status={trifecta} loading={trifectaLoading} />
                </div>,
                document.body
            )}
        </>
    );
}
