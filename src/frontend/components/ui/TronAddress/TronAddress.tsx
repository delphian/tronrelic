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
 */
'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ExternalLink, Wrench } from 'lucide-react';
import { TrCopyIcon } from '../TrCopyIcon';
import { IconButton } from '../IconButton';
import { Tooltip } from '../Tooltip';
import { FORWARDABLE_TOOLS, buildToolForwardUrl } from './forwardableTools';
import styles from './TronAddress.module.scss';

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
 * Minimum gap (px) to keep between the open tools menu and the viewport edge
 * when deciding which way it opens. The menu flips above its trigger only when
 * the space below cannot fit the menu plus this breathing room, so a menu near
 * the bottom of a scroll-clipped container (the shared `Table` wrapper sets
 * `overflow: auto`) opens upward into visible space instead of being clipped.
 */
const MENU_VIEWPORT_GAP_PX = 8;

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
    const [menuPlacement, setMenuPlacement] = useState<'bottom' | 'top'>('bottom');
    const menuRef = useRef<HTMLDivElement | null>(null);
    const menuListRef = useRef<HTMLDivElement | null>(null);

    /**
     * Close the tools popover on any click outside it and on Escape, why: an
     * anchored menu that only dismisses via its own toggle is a well-known
     * usability trap. The listeners attach only while the menu is open, so
     * they are a no-op in the common closed state. Mirrors the Tooltip
     * primitive's outside-pointer handling.
     */
    useEffect(() => {
        if (!menuOpen) return undefined;
        function handlePointerDown(event: globalThis.PointerEvent): void {
            const menu = menuRef.current;
            if (menu && !menu.contains(event.target as Node)) {
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
     * Choose whether the open menu drops below its trigger or flips above it,
     * why: the menu is absolutely positioned and cannot escape an ancestor's
     * overflow box (a portal would, but that is heavier machinery than this
     * primitive warrants — see the flip precedent in the sibling Tooltip). When
     * the trigger sits near the bottom of the viewport (the common clipped case
     * inside a scrolling table), opening downward would render the menu into
     * clipped space; flipping it upward keeps it visible. Runs in a layout
     * effect so the corrected side is set before paint (no downward flash), and
     * re-measures on resize so a menu left open through a viewport change stays
     * placed. Measuring needs the menu in the DOM, so this depends on menuOpen.
     */
    useLayoutEffect(() => {
        if (!menuOpen) {
            setMenuPlacement('bottom');
            return undefined;
        }
        function updatePlacement(): void {
            const anchor = menuRef.current;
            const menu = menuListRef.current;
            if (!anchor || !menu) return;
            const anchorRect = anchor.getBoundingClientRect();
            const menuHeight = menu.getBoundingClientRect().height;
            const viewportHeight = document.documentElement.clientHeight;
            const spaceBelow = viewportHeight - anchorRect.bottom;
            const spaceAbove = anchorRect.top;
            const fitsBelow = spaceBelow >= menuHeight + MENU_VIEWPORT_GAP_PX;
            setMenuPlacement(!fitsBelow && spaceAbove > spaceBelow ? 'top' : 'bottom');
        }
        updatePlacement();
        window.addEventListener('resize', updatePlacement);
        return () => window.removeEventListener('resize', updatePlacement);
    }, [menuOpen]);

    const display = label ?? truncateAddress(address);

    return (
        <span className={[styles.root, className].filter(Boolean).join(' ')}>
            <Tooltip content={address}>
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
                // Stop tool clicks (the wrench toggle and the menu-item links,
                // both descendants of this wrapper) from bubbling to an enclosing
                // clickable row (`<Tr onClick>`), which would navigate or unmount
                // the chip before the menu is usable. Mirrors CopyButton, which
                // stops propagation for the same reason. preventDefault is not
                // called, so the tool links still navigate.
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
                    {menuOpen && (
                        <div
                            ref={menuListRef}
                            className={[styles.menu, menuPlacement === 'top' ? styles.menu_top : '']
                                .filter(Boolean)
                                .join(' ')}
                            role="menu"
                        >
                            {FORWARDABLE_TOOLS.map(tool => (
                                <a
                                    key={tool.slug}
                                    role="menuitem"
                                    className={styles.menu_item}
                                    href={buildToolForwardUrl(tool.slug, address)}
                                    onClick={() => setMenuOpen(false)}
                                >
                                    {tool.label}
                                </a>
                            ))}
                        </div>
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
