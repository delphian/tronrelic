'use client';

/**
 * @file ConversationCopyMenu.tsx
 *
 * The copy control for a whole conversation, used on the Query tab's chat header
 * and on each row of the conversation rail. It is a menu rather than a plain
 * button because a conversation has more than one useful clipboard shape: a
 * readable Markdown transcript for pasting into a ticket, the full transcript
 * with thinking and tool payloads for explaining an agentic run, and plain text
 * for a field that will not render Markdown. A single button has to guess, and
 * the control this replaces guessed badly — it copied only the opening prompt.
 *
 * The panel renders into a `<body>` portal for the same reason the tool dropdown
 * beside the composer does: the chat card clips its overflow so the transcript
 * scrolls inside rounded corners, and the rail scrolls too, so a panel anchored
 * inline would be cut off at the nearest edge. A portal escapes that clipping at
 * the cost of placing the panel by hand and managing focus by hand, and both are
 * handled here the way `ToolAllowlistDropdown` handles them.
 *
 * This is an interactive admin control rather than an SSR-first public
 * component, and it renders nothing until an operator opens it, so it has no
 * server-rendered markup to match.
 *
 * The component owns only its open state, its geometry, and the keyboard access
 * the portal would otherwise cost. The caller owns what gets copied, because
 * copying the open transcript and copying a past conversation are different
 * amounts of work — the second has to fetch that conversation's turns first.
 */

import { useState, useRef, useEffect, useLayoutEffect, useCallback, useId, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Copy, CheckCircle } from 'lucide-react';
import { IconButton } from '../../../../../components/ui/IconButton';
import { CONVERSATION_COPY_OPTIONS, type ConversationCopyFormat } from '../tabs/formatConversation';
import styles from './ConversationCopyMenu.module.scss';

/** Space (px) between the trigger and the panel, and the minimum viewport inset. */
const PANEL_GAP_PX = 4;

/** Preferred panel width (px) — wide enough that no option description wraps. */
const PREFERRED_PANEL_WIDTH_PX = 260;

/** Resolved viewport-fixed geometry for the portaled panel. */
interface IPanelPosition {
    top: number;
    left: number;
    width: number;
}

/** Props for {@link ConversationCopyMenu}. */
export interface IConversationCopyMenuProps {
    /**
     * Copies the conversation in the chosen format. Allowed to be async because
     * a rail row has to fetch its turns before it can format them; the menu
     * closes immediately either way rather than sitting open over a request the
     * operator cannot see.
     */
    onCopy: (format: ConversationCopyFormat) => void | Promise<void>;
    /** Whether this control's copy just succeeded, so it shows a check. */
    copied: boolean;
    /** Accessible label for the trigger, naming which conversation it copies. */
    label: string;
    /** Tap-target size, matching whichever row the control sits in. */
    size?: 'xs' | 'sm';
    /** Extra class for the trigger, so a caller can place it within its own row. */
    className?: string;
}

/**
 * Render the copy trigger and, while open, its portaled format menu.
 *
 * @param props - See {@link IConversationCopyMenuProps}.
 * @returns The copy menu.
 */
export function ConversationCopyMenu({
    onCopy,
    copied,
    label,
    size = 'xs',
    className
}: IConversationCopyMenuProps) {
    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState<IPanelPosition | null>(null);
    const panelId = useId();
    const triggerRef = useRef<HTMLButtonElement>(null);
    const panelRef = useRef<HTMLDivElement>(null);
    /**
     * Whether focus has already moved into the panel for this opening. The panel
     * re-measures on every scroll and resize, so without this latch the focus
     * effect would pull focus back to the container each time the operator
     * scrolled the rail while the menu was open.
     */
    const focusMovedRef = useRef(false);

    // Dismiss on an outside click. The panel is portaled to `<body>` and is not
    // a descendant of the trigger, so both nodes have to be tested — otherwise
    // the mousedown beginning a click on an option would close the panel before
    // that option's own handler ran.
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
     * scroll (captured, so scrolling the rail counts) and on resize. Runs as a
     * layout effect so the coordinates are set before paint; otherwise the panel
     * flashes at the viewport origin.
     *
     * The panel opens upward when the space below cannot hold it and the space
     * above is roomier, which is the normal case for a rail row near the bottom
     * of a long list. Both axes are clamped into the viewport, because a fixed
     * element pushed past an edge cannot be scrolled back into view.
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
            // the height it will have once React writes the same width back.
            const width = Math.min(PREFERRED_PANEL_WIDTH_PX, viewportWidth - PANEL_GAP_PX * 2);
            panel.style.width = `${width}px`;
            const height = panel.scrollHeight;
            const spaceBelow = viewportHeight - anchorRect.bottom - PANEL_GAP_PX * 2;
            const spaceAbove = anchorRect.top - PANEL_GAP_PX * 2;
            const openAbove = height > spaceBelow && spaceAbove > spaceBelow;
            const preferredTop = openAbove
                ? anchorRect.top - PANEL_GAP_PX - height
                : anchorRect.bottom + PANEL_GAP_PX;
            const top = Math.max(
                PANEL_GAP_PX,
                Math.min(preferredTop, viewportHeight - height - PANEL_GAP_PX)
            );
            // Right-aligned to the trigger, because this control sits at the end
            // of its row in both call sites and a left-aligned panel would hang
            // off that edge.
            const preferredLeft = anchorRect.right - width;
            const left = Math.max(
                PANEL_GAP_PX,
                Math.min(preferredLeft, viewportWidth - width - PANEL_GAP_PX)
            );
            setPosition({ top, left, width });
        }
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [open]);

    /*
     * Hand focus to the panel once it is open and placed. Portaling moves the
     * options to the end of `<body>`, so Tab from the trigger would walk the
     * whole rest of the page before reaching one — the panel has to claim focus
     * itself or the control is mouse-only. Focus lands on the panel container
     * rather than on the first option, so opening the menu never reads as having
     * pre-selected a format.
     *
     * Deferred until `position` resolves, because until then the panel renders
     * hidden to avoid a flash at the viewport origin, and a hidden element
     * cannot take focus.
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
     * Move focus between the options with the arrow keys. Enter and Space
     * activate natively because the options are real buttons, and Escape is
     * already bound above, so only the vertical traversal is missing — without
     * it a keyboard operator would have to Tab out of document order to reach
     * the list.
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
     * Run the caller's copy for one format and dismiss the menu.
     *
     * The menu closes before the copy resolves rather than after, because a rail
     * row's copy has to fetch the conversation first and holding the panel open
     * over an unexplained pause reads as a control that did not respond. The
     * confirmation an operator watches for is the checkmark on the trigger,
     * which the caller drives through `copied`.
     *
     * @param format - The format the operator picked.
     */
    const handleSelect = useCallback((format: ConversationCopyFormat): void => {
        setOpen(false);
        triggerRef.current?.focus();
        void onCopy(format);
    }, [onCopy]);

    return (
        <>
            <IconButton
                ref={triggerRef}
                variant="ghost"
                size={size}
                className={className}
                onClick={() => setOpen(value => !value)}
                aria-haspopup="menu"
                aria-expanded={open}
                aria-controls={open ? panelId : undefined}
                aria-label={label}
                title={label}
            >
                {copied ? <CheckCircle size={14} /> : <Copy size={14} />}
            </IconButton>

            {open && createPortal(
                <div
                    ref={panelRef}
                    id={panelId}
                    role="menu"
                    aria-label="Copy format"
                    className={styles.panel}
                    // Focusable only programmatically: the panel takes focus on
                    // open so the options are reachable, but never joins the tab
                    // order itself at the end of `<body>`.
                    tabIndex={-1}
                    onKeyDown={handlePanelKeyDown}
                    style={position
                        ? { top: position.top, left: position.left, width: position.width }
                        : { visibility: 'hidden' }}
                >
                    {CONVERSATION_COPY_OPTIONS.map(option => (
                        <button
                            key={option.format}
                            type="button"
                            role="menuitem"
                            className={styles.option}
                            onClick={() => handleSelect(option.format)}
                        >
                            <span className={styles.option_label}>{option.label}</span>
                            <span className={styles.option_description}>{option.description}</span>
                        </button>
                    ))}
                </div>,
                document.body
            )}
        </>
    );
}
