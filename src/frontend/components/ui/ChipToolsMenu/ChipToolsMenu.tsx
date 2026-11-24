/**
 * @fileoverview The wrench menu shared by the address and transaction id chips.
 *
 * Every identifier chip (`TronAddress`, `TronContractAddress`,
 * `TronTransactionId`) shows exactly one icon after its value: a wrench. Its
 * menu always starts with copying the value and opening it on Tronscan, and a
 * chip may add entries below a divider, such as the address chip's tool pages
 * and tag editor. One icon per value keeps dense rows readable, and keeping
 * the menu in one component means the chips cannot drift apart in how the
 * menu opens, where it is placed, or how a keyboard reaches it.
 *
 * The menu renders in a `<body>` portal with viewport-fixed coordinates,
 * because an absolutely anchored menu is clipped inside any scrolling
 * ancestor: the shared `Table` wrapper sets `overflow-x: auto`, CSS turns the
 * other axis into `auto` too, and a menu opening below a row is cut at the
 * table's edge.
 *
 * This component is internal to `components/ui/`. Application and plugin code
 * renders one of the chips rather than this menu directly.
 */
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { Check, Copy, ExternalLink, Wrench } from 'lucide-react';
import { IconButton } from '../IconButton';
import { useCopyToClipboard } from '../../../lib/hooks/useCopyToClipboard';
import styles from './ChipToolsMenu.module.scss';

/**
 * Minimum gap (px) to keep between the open menu and both its trigger and the
 * viewport edge. The menu flips above its trigger only when the space below
 * cannot fit the menu plus this breathing room.
 */
const MENU_VIEWPORT_GAP_PX = 8;

/**
 * Pixel size of the icons beside the Copy and Tronscan entries. Matches the
 * 14px inline-icon step the UI system uses for text at body-sm size, which is
 * what the menu rows are set in.
 */
const MENU_ICON_PX = 14;

/**
 * Viewport-fixed coordinates for the portaled menu, resolved from the
 * trigger's live bounding rect. Held in state (rather than derived in render)
 * because measuring requires the DOM, and `null` marks "not yet measured" so
 * the menu stays invisible instead of flashing at the origin.
 */
interface IMenuPosition {
    top: number;
    left: number;
}

/**
 * One extra menu entry a chip adds below the divider. An entry with `href`
 * opens that page in a new tab; an entry with `onSelect` is a button that runs
 * in place, such as opening a dialog. The menu closes either way.
 */
export type ChipToolsMenuEntry =
    | { key: string; label: string; href: string }
    | { key: string; label: string; onSelect: () => void };

/**
 * Props for {@link ChipToolsMenu}.
 */
export interface IChipToolsMenuProps {
    /** The full value the Copy entry places on the clipboard. */
    value: string;
    /** Screen-reader label for the wrench, naming what the menu acts on. */
    triggerLabel: string;
    /** Text of the entry that copies the value. */
    copyLabel: string;
    /** Text the copy entry shows, and a screen reader announces, after a copy. */
    copiedLabel: string;
    /** Explorer page for the value, opened in a new tab. */
    explorerHref: string;
    /** Text of the entry that opens the explorer page. */
    explorerLabel: string;
    /** Chip-specific entries shown below a divider, in menu order. May be empty. */
    entries?: readonly ChipToolsMenuEntry[];
}

/**
 * Render the wrench and, while open, its portaled menu: Copy, the explorer
 * link, then any chip-specific entries. See the file overview for why every
 * identifier chip shares this menu.
 *
 * @param props - {@link IChipToolsMenuProps}; the chip supplies the value, the
 *        wording for its kind of value, and any extra entries.
 * @returns The wrench trigger, with the menu portaled to `<body>` while open.
 */
export function ChipToolsMenu({
    value,
    triggerLabel,
    copyLabel,
    copiedLabel,
    explorerHref,
    explorerLabel,
    entries = []
}: IChipToolsMenuProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<IMenuPosition | null>(null);
    const anchorRef = useRef<HTMLDivElement | null>(null);
    const menuListRef = useRef<HTMLDivElement | null>(null);
    const triggerRef = useRef<HTMLButtonElement | null>(null);
    /**
     * Whether focus has already moved into the menu for this opening. The menu
     * re-measures on every scroll and resize, so without this latch the focus
     * effect below would drag focus back to the first entry each time the user
     * scrolled the table under an open menu.
     */
    const focusMovedRef = useRef(false);
    const { copied, copy } = useCopyToClipboard(value);

    /**
     * Close the menu and put focus back on the wrench, why: the entries live in
     * a `<body>` portal, so an entry that unmounts itself leaves focus on a
     * removed node and the browser falls back to `<body>`, making a keyboard
     * user restart from the top of the page. Only the paths the user drove from
     * inside the menu call this — Escape, choosing an entry, or tabbing out. An
     * outside click deliberately does not, because focus belongs wherever the
     * user just put it.
     */
    const closeMenu = useCallback((): void => {
        setMenuOpen(false);
        triggerRef.current?.focus();
    }, []);

    /**
     * Close the menu on any click outside it and on Escape, why: a menu that
     * only dismisses via its own toggle is a well-known usability trap. The
     * listeners attach only while the menu is open, so they are a no-op in the
     * common closed state. The menu is portaled to `<body>`, so it is not a
     * descendant of the anchor — both nodes are checked or clicking an entry
     * would dismiss the menu before the entry acts.
     */
    useEffect(() => {
        if (!menuOpen) return undefined;
        /**
         * Dismiss the menu when a pointer lands outside both the trigger and
         * the portaled menu.
         *
         * @param event - The document-level pointer event being tested.
         */
        function handlePointerDown(event: globalThis.PointerEvent): void {
            const anchor = anchorRef.current;
            const menu = menuListRef.current;
            const target = event.target as Node;
            const inside = Boolean(anchor?.contains(target)) || Boolean(menu?.contains(target));
            if (!inside) {
                setMenuOpen(false);
            }
        }
        /**
         * Dismiss the menu on Escape so keyboard users are never trapped in it,
         * handing focus back to the wrench they opened it from.
         */
        function handleKeyDown(event: globalThis.KeyboardEvent): void {
            if (event.key === 'Escape') closeMenu();
        }
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [closeMenu, menuOpen]);

    /**
     * Toggle the menu. Extracted so the toggle and the outside-click effect
     * share one piece of state and the button stays a pure view.
     */
    const toggleMenu = useCallback((): void => {
        setMenuOpen(prev => !prev);
    }, []);

    /**
     * Keyboard movement between the menu entries, why: the menu is portaled, so
     * the entries are not Tab-reachable from the wrench in any useful order and
     * the arrow keys are the only traversal a menu offers. Enter and Space
     * activate an entry natively, because every entry is a real button or link.
     * Tab closes the menu instead of walking into the end of `<body>`, which is
     * where the portal put these nodes. Bound to the menu rather than to each
     * entry because React bubbles a portal's events through the component tree.
     *
     * @param event - Key event bubbling up from the focused entry.
     */
    const handleMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>): void => {
        const items = Array.from(
            menuListRef.current?.querySelectorAll<HTMLElement>('[role="menuitem"]') ?? []
        );
        const index = items.indexOf(document.activeElement as HTMLElement);
        const last = items.length - 1;
        let next: number | null = null;

        if (event.key === 'ArrowDown') {
            next = index >= last ? 0 : index + 1;
        } else if (event.key === 'ArrowUp') {
            next = index <= 0 ? last : index - 1;
        } else if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = last;
        } else if (event.key === 'Tab') {
            event.preventDefault();
            closeMenu();
        }

        if (next !== null && items.length > 0) {
            // Suppress the page scroll the arrow keys would otherwise cause.
            event.preventDefault();
            items[next]?.focus();
        }
    }, [closeMenu]);

    /**
     * Resolve the open menu's viewport-fixed coordinates from its trigger, why:
     * an absolutely-positioned menu cannot escape an ancestor's overflow box,
     * and a chip's most common home is a scroll container. The menu is placed
     * below the trigger when the viewport has room, flipped above it when not,
     * and clamped so it never runs off the right edge.
     *
     * Runs in a layout effect so the position is set before paint (no flash at
     * the origin), and re-measures on scroll and resize because a fixed menu
     * does not follow its trigger the way an anchored one does. Scroll is
     * captured so scrolling a table — not just the window — repositions too.
     */
    useLayoutEffect(() => {
        if (!menuOpen) {
            setMenuPosition(null);
            return undefined;
        }
        /**
         * Measure the trigger and the menu, then place the menu below or above
         * the trigger and inside the viewport.
         */
        function updatePosition(): void {
            const anchor = anchorRef.current;
            const menu = menuListRef.current;
            if (!anchor || !menu) return;
            const anchorRect = anchor.getBoundingClientRect();
            const menuRect = menu.getBoundingClientRect();
            const viewportHeight = document.documentElement.clientHeight;
            const viewportWidth = document.documentElement.clientWidth;
            const spaceBelow = viewportHeight - anchorRect.bottom;
            const spaceAbove = anchorRect.top;
            const fitsBelow = spaceBelow >= menuRect.height + MENU_VIEWPORT_GAP_PX;
            const openAbove = !fitsBelow && spaceAbove > spaceBelow;
            const top = openAbove
                ? anchorRect.top - menuRect.height - MENU_VIEWPORT_GAP_PX
                : anchorRect.bottom + MENU_VIEWPORT_GAP_PX;
            const maxLeft = viewportWidth - menuRect.width - MENU_VIEWPORT_GAP_PX;
            const left = Math.max(MENU_VIEWPORT_GAP_PX, Math.min(anchorRect.left, maxLeft));
            setMenuPosition({ top, left });
        }
        updatePosition();
        window.addEventListener('resize', updatePosition);
        window.addEventListener('scroll', updatePosition, true);
        return () => {
            window.removeEventListener('resize', updatePosition);
            window.removeEventListener('scroll', updatePosition, true);
        };
    }, [menuOpen]);

    /**
     * Move focus to the first entry once the menu is open and placed, why: the
     * menu is portaled to `<body>`, so its entries sit at the very end of the
     * tab order, and tabbing from the wrench walks every remaining control on
     * the page first — hundreds of them in a dense table. Copy and the explorer
     * link are only reachable through this menu, so it has to claim focus itself
     * or both actions are mouse-only.
     *
     * Deferred until `menuPosition` resolves, because until then the menu
     * renders hidden to avoid a flash at the viewport origin, and a hidden
     * element cannot take focus.
     */
    useLayoutEffect(() => {
        if (!menuOpen) {
            focusMovedRef.current = false;
        } else if (menuPosition && !focusMovedRef.current) {
            focusMovedRef.current = true;
            menuListRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
        }
    }, [menuOpen, menuPosition]);

    return (
        // Stop menu clicks from bubbling to an enclosing clickable row
        // (`<Tr onClick>`), which would navigate or unmount the chip before the
        // menu is usable. preventDefault is not called, so the menu links still
        // navigate. The portaled menu is not a descendant of this wrapper, so it
        // stops propagation itself — its own DOM position is under `<body>`, but
        // React still bubbles its events through this tree.
        <div
            className={styles.anchor}
            ref={anchorRef}
            onClick={event => event.stopPropagation()}
        >
            <IconButton
                ref={triggerRef}
                variant="primary"
                size="xs"
                aria-label={triggerLabel}
                aria-haspopup="menu"
                aria-expanded={menuOpen}
                onClick={toggleMenu}
                className={styles.trigger}
            >
                <Wrench size={14} />
            </IconButton>
            {menuOpen && createPortal(
                <div
                    ref={menuListRef}
                    className={styles.menu}
                    role="menu"
                    // Hidden until measured so the first paint never shows the
                    // menu parked at the viewport origin.
                    style={
                        menuPosition
                            ? { top: menuPosition.top, left: menuPosition.left }
                            : { top: 0, left: 0, visibility: 'hidden' }
                    }
                    onClick={event => event.stopPropagation()}
                    onKeyDown={handleMenuKeyDown}
                >
                    {/*
                      * Copy keeps the menu open, why: the entry's own text and
                      * icon switch to the copied confirmation, and closing the
                      * menu at once would hide the only sign that the copy
                      * worked. The label sits in a polite live region so a
                      * screen reader announces the change while focus stays on
                      * the entry.
                      */}
                    <button
                        type="button"
                        role="menuitem"
                        className={styles.menu_item}
                        onClick={copy}
                    >
                        {copied
                            ? <Check size={MENU_ICON_PX} aria-hidden="true" className={styles.menu_icon} />
                            : <Copy size={MENU_ICON_PX} aria-hidden="true" className={styles.menu_icon} />}
                        <span aria-live="polite">{copied ? copiedLabel : copyLabel}</span>
                    </button>
                    {/*
                      * The explorer entry and every link entry open a new tab,
                      * why: the chip is an aside on whatever the user is
                      * actually reading — a transaction feed, a ladder, an
                      * admin table — and navigating in place destroys that
                      * context (and any in-page state, filters, or live stream
                      * behind it) for a lookup the user means to glance at. A
                      * new tab also makes a tool forward work when the target
                      * tool *is* the current page: same-route client navigation
                      * would not remount the tool, leaving its mount-only
                      * pre-fill stale. `rel="noopener"` is mandatory with
                      * `_blank` — without it the opened page gets
                      * `window.opener`.
                      */}
                    <a
                        role="menuitem"
                        className={styles.menu_item}
                        href={explorerHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={closeMenu}
                    >
                        <ExternalLink size={MENU_ICON_PX} aria-hidden="true" className={styles.menu_icon} />
                        <span>{explorerLabel}</span>
                    </a>
                    {entries.length > 0 && (
                        <div role="separator" className={styles.menu_divider} />
                    )}
                    {entries.map(entry => ('href' in entry
                        ? (
                            <a
                                key={entry.key}
                                role="menuitem"
                                className={styles.menu_item}
                                href={entry.href}
                                target="_blank"
                                rel="noopener noreferrer"
                                onClick={closeMenu}
                            >
                                {entry.label}
                            </a>
                        )
                        : (
                            // A button, not a link: it acts in place, such as
                            // opening a dialog. The menu closes first so focus
                            // is back on the wrench when the dialog records
                            // where to return it.
                            <button
                                key={entry.key}
                                type="button"
                                role="menuitem"
                                className={styles.menu_item}
                                onClick={() => {
                                    closeMenu();
                                    entry.onSelect();
                                }}
                            >
                                {entry.label}
                            </button>
                        )
                    ))}
                </div>,
                document.body
            )}
        </div>
    );
}
