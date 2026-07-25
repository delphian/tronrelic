/**
 * @fileoverview Canonical TRON address chip.
 *
 * Every surface that shows a wallet/contract address — core pages, admin
 * tables, plugin UIs injected through `context.ui.TronAddress` — should render
 * it through this one component so truncation, copy, explorer linking, and
 * tool-forwarding stay identical everywhere and only have to be fixed in one
 * place. Before this existed each caller hand-rolled its own slice/tronscan
 * link, drifting in format and affordances.
 *
 * The chip renders synchronously from its `address` prop (no async, no data
 * fetch), so it is SSR-first by construction: the truncated text is in the
 * server HTML and only the copy, tools, and explorer affordances are
 * user-triggered after hydration. All three render as bare icons — the copy
 * control is a `<TrCopyIcon>` rather than a `<CopyButton>` so it carries no
 * more visual weight than the wrench and out-link beside it. It is a
 * `'use client'` component purely because those affordances need event handlers
 * and a click-outside listener.
 *
 * The tools menu renders in a `<body>` portal with viewport-fixed coordinates.
 * An earlier revision anchored it absolutely and only flipped it upward near the
 * viewport bottom, which left it clipped inside any scrolling ancestor — the
 * shared `Table` wrapper sets `overflow-x: auto`, and CSS turns the other axis
 * into `auto` too, so a menu opening below a row was cut at the table's edge
 * regardless of the space beyond it.
 */
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ExternalLink, Wrench } from 'lucide-react';
import { TrCopyIcon } from '../TrCopyIcon';
import { IconButton } from '../IconButton';
import { Tooltip } from '../Tooltip';
import { useModal } from '../ModalProvider';
// Deep imports rather than the module barrels: the address-tags barrel re-exports
// its editor, which imports core UI primitives, so pulling the barrel in here
// would close an import cycle through this file. The user barrel is skipped for
// the established reason that it drags component CSS into every bundle.
import { useAddressTags } from '../../../modules/address-tags/hooks/useAddressTags';
import { AddressTagsEditor } from '../../../modules/address-tags/components/AddressTagsEditor/AddressTagsEditor';
import { useAuthSession } from '../../../modules/user/components/SessionProvider';
import { FORWARDABLE_TOOLS, buildToolForwardUrl } from './forwardableTools';
import styles from './TronAddress.module.scss';

/**
 * Group whose members may change tags. Address-tag reads are open to any
 * logged-in visitor, but every mutation route is `requireAdmin`, so the edit
 * affordance is gated on the same membership the backend enforces — offering it
 * more widely would only produce a 403 after the operator typed.
 */
const TAG_EDIT_GROUP = 'admin';

/**
 * Base58 explorer deep-link root. Tronscan is hardcoded because the codebase
 * has no configurable explorer provider today; every existing address link
 * points here. Centralizing it means a future switch to a configurable
 * provider changes one line rather than every caller.
 */
const TRONSCAN_ADDRESS_URL = 'https://tronscan.org/#/address/';

/**
 * Characters kept from each end when truncating. Four leading characters keep
 * the `T` prefix plus enough entropy to disambiguate at a glance; four
 * trailing characters mirror it. Addresses shorter than the combined length
 * render whole (nothing to hide).
 */
const HEAD_CHARS = 4;
const TAIL_CHARS = 4;

/**
 * Minimum gap (px) to keep between the open tools menu and both its trigger and
 * the viewport edge. The menu flips above its trigger only when the space below
 * cannot fit the menu plus this breathing room.
 */
const MENU_VIEWPORT_GAP_PX = 8;

/**
 * Viewport-fixed coordinates for the portaled tools menu, resolved from the
 * trigger's live bounding rect. Held in state (rather than derived in render)
 * because measuring requires the DOM, and `null` marks "not yet measured" so
 * the menu stays invisible instead of flashing at the origin.
 */
interface IMenuPosition {
    top: number;
    left: number;
}

/**
 * Props for {@link TronAddress}.
 */
export interface ITronAddressProps {
    /** Full base58check TRON address (`T…`). The value copied and linked. */
    address: string;
    /**
     * Pre-resolved human label. When supplied it displays in place of the
     * truncated address (the full address still shows in the tooltip), matching
     * the label-first convention. The component does not look labels up itself —
     * callers pass one already resolved (e.g. from an SSR data fetcher).
     */
    label?: string;
    /** Show the copy-to-clipboard affordance. @default true */
    copy?: boolean;
    /** Show the "forward to a tool" dropdown. @default true */
    tools?: boolean;
    /** Show the external Tronscan link. @default true */
    explorer?: boolean;
    /** Extra class on the root wrapper for spacing in a host layout. */
    className?: string;
}

/**
 * Shorten a full address to `head…tail`, why: a full 34-char base58 address
 * dominates dense tables and buries the surrounding data. Short inputs pass
 * through untouched so we never render a `…` that hides nothing.
 *
 * @param address - Full address to shorten; supplied by the caller's data row.
 * @returns The truncated display string, or the input unchanged when it is
 *          already at or below the combined head+tail length.
 */
function truncateAddress(address: string): string {
    let result = address;
    if (address.length > HEAD_CHARS + TAIL_CHARS + 1) {
        result = `${address.slice(0, HEAD_CHARS)}…${address.slice(-TAIL_CHARS)}`;
    }
    return result;
}

/**
 * Render a TRON address as a compact, monospace chip with copy, tool-forward,
 * and explorer affordances. See the file overview for why this is the single
 * canonical address renderer.
 *
 * @param props - {@link ITronAddressProps}; `address` is required, the three
 *        affordance booleans default on so the common case needs only the
 *        address, and callers trim affordances off for read-only contexts.
 * @returns The address chip element.
 */
export function TronAddress({
    address,
    label,
    copy = true,
    tools = true,
    explorer = true,
    className
}: ITronAddressProps) {
    const [menuOpen, setMenuOpen] = useState(false);
    const [menuPosition, setMenuPosition] = useState<IMenuPosition | null>(null);
    const menuRef = useRef<HTMLDivElement | null>(null);
    const menuListRef = useRef<HTMLDivElement | null>(null);
    const tags = useAddressTags(address);
    const { session } = useAuthSession();
    const modal = useModal();
    const canEditTags = session?.user?.groups?.includes(TAG_EDIT_GROUP) ?? false;

    /**
     * Close the tools popover on any click outside it and on Escape, why: an
     * anchored menu that only dismisses via its own toggle is a well-known
     * usability trap. The listeners attach only while the menu is open, so
     * they are a no-op in the common closed state. Mirrors the Tooltip
     * primitive's outside-pointer handling. The menu itself is portaled to
     * `<body>`, so it is not a descendant of the anchor — both nodes are
     * checked or clicking a tool link would dismiss before it navigates.
     */
    useEffect(() => {
        if (!menuOpen) return undefined;
        function handlePointerDown(event: globalThis.PointerEvent): void {
            const anchor = menuRef.current;
            const menu = menuListRef.current;
            const target = event.target as Node;
            const inside = Boolean(anchor?.contains(target)) || Boolean(menu?.contains(target));
            if (!inside) {
                setMenuOpen(false);
            }
        }
        function handleKeyDown(event: globalThis.KeyboardEvent): void {
            if (event.key === 'Escape') setMenuOpen(false);
        }
        document.addEventListener('pointerdown', handlePointerDown);
        document.addEventListener('keydown', handleKeyDown);
        return () => {
            document.removeEventListener('pointerdown', handlePointerDown);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [menuOpen]);

    /**
     * Toggle the tools popover. Extracted so the toggle and the outside-click
     * effect share one piece of state and the button stays a pure view.
     */
    const toggleMenu = useCallback((): void => {
        setMenuOpen(prev => !prev);
    }, []);

    /**
     * Resolve the open menu's viewport-fixed coordinates from its trigger, why:
     * an absolutely-positioned menu cannot escape an ancestor's overflow box, and
     * the chip's most common home is a scroll container — the shared `Table`
     * wrapper sets `overflow-x: auto`, which per CSS also clips vertically, so a
     * menu opening below a row was cut off at the table's edge no matter how much
     * viewport space remained. The menu therefore renders in a `<body>` portal and
     * is placed here: below the trigger when the viewport has room, flipped above
     * it when not, and clamped so it never runs off the right edge.
     *
     * Runs in a layout effect so the position is set before paint (no flash at the
     * origin), and re-measures on scroll and resize because a fixed menu does not
     * follow its trigger the way an anchored one does. Scroll is captured so
     * scrolling the *table* — not just the window — repositions too. Measuring
     * needs the menu mounted, so this depends on `menuOpen`.
     */
    useLayoutEffect(() => {
        if (!menuOpen) {
            setMenuPosition(null);
            return undefined;
        }
        function updatePosition(): void {
            const anchor = menuRef.current;
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
     * Open the freeform tag editor for this address in the shared core modal.
     *
     * The editor lives in the address-tags module and is handed the tags already
     * resolved for the chip, so it opens seeded rather than fetching again. The
     * modal is closed by id from inside the editor, which also invalidates the
     * shared read cache so every chip on the page picks the change up.
     */
    const openTagEditor = useCallback((): void => {
        setMenuOpen(false);
        const id = `address-tags:${address}`;
        modal.open({
            id,
            title: 'Edit tags',
            size: 'sm',
            content: (
                <AddressTagsEditor
                    address={address}
                    initialTags={tags}
                    onClose={() => modal.close(id)}
                />
            )
        });
    }, [address, modal, tags]);

    const display = label ?? truncateAddress(address);
    // Tags ride in the tooltip rather than beside the chip: they are context for
    // "which wallet is this", and a chip that grew inline chips would reflow
    // every dense table it sits in.
    const tooltip = tags.length > 0 ? `${address} (${tags.join(', ')})` : address;

    return (
        <span className={[styles.root, className].filter(Boolean).join(' ')}>
            <Tooltip content={tooltip}>
                <span
                    className={label ? styles.label : styles.address}
                    data-testid="tron-address-display"
                >
                    {display}
                </span>
            </Tooltip>

            {copy && (
                // Icon-only, matching the wrench and out-link beside it: a
                // bordered button here made copy read as the chip's primary
                // action rather than one of three equal affordances.
                <TrCopyIcon
                    value={address}
                    size="xs"
                    aria-label="Copy address"
                    copiedLabel="Address copied"
                    className={styles.action}
                />
            )}

            {tools && (
                // Stop tool clicks from bubbling to an enclosing clickable row
                // (`<Tr onClick>`), which would navigate or unmount the chip
                // before the menu is usable. Mirrors CopyButton, which stops
                // propagation for the same reason. preventDefault is not called,
                // so the tool links still navigate. The portaled menu is not a
                // descendant of this wrapper, so it stops propagation itself —
                // its own DOM position is under `<body>`, but React still
                // bubbles its events through this tree.
                <div
                    className={styles.menu_anchor}
                    ref={menuRef}
                    onClick={event => event.stopPropagation()}
                >
                    <IconButton
                        variant="primary"
                        size="xs"
                        aria-label="Forward address to a tool"
                        aria-haspopup="menu"
                        aria-expanded={menuOpen}
                        onClick={toggleMenu}
                        className={styles.action}
                    >
                        <Wrench size={14} />
                    </IconButton>
                    {menuOpen && createPortal(
                        <div
                            ref={menuListRef}
                            className={styles.menu}
                            role="menu"
                            // Hidden until measured so the first paint never
                            // shows the menu parked at the viewport origin.
                            style={
                                menuPosition
                                    ? { top: menuPosition.top, left: menuPosition.left }
                                    : { top: 0, left: 0, visibility: 'hidden' }
                            }
                            onClick={event => event.stopPropagation()}
                        >
                            {/*
                              * Forwarding opens a new tab, why: the chip is an
                              * aside on whatever the user is actually reading —
                              * a transaction feed, a ladder, an admin table —
                              * and sending a tool off in place destroys that
                              * context (and any in-page state, filters, or live
                              * stream behind it) for a lookup the user means to
                              * glance at. A new tab also makes the forward work
                              * when the target tool *is* the current page: same
                              * -route client navigation would not remount the
                              * tool, leaving its mount-only `?address=` pre-fill
                              * stale and the menu entry looking inert.
                              * `rel="noopener"` is mandatory with `_blank` —
                              * without it the opened page gets `window.opener`.
                              */}
                            {FORWARDABLE_TOOLS.map(tool => (
                                <a
                                    key={tool.slug}
                                    role="menuitem"
                                    className={styles.menu_item}
                                    href={buildToolForwardUrl(tool.slug, address)}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    onClick={() => setMenuOpen(false)}
                                >
                                    {tool.label}
                                </a>
                            ))}
                            {canEditTags && (
                                // A button, not a link: it opens a modal in place
                                // rather than navigating, so the tool-forward
                                // links above stay the only anchors here.
                                <button
                                    type="button"
                                    role="menuitem"
                                    className={styles.menu_item}
                                    onClick={openTagEditor}
                                >
                                    Edit tags
                                </button>
                            )}
                        </div>,
                        document.body
                    )}
                </div>
            )}

            {explorer && (
                <a
                    className={styles.action_link}
                    href={`${TRONSCAN_ADDRESS_URL}${address}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="View address on Tronscan"
                >
                    <ExternalLink size={14} />
                </a>
            )}
        </span>
    );
}
