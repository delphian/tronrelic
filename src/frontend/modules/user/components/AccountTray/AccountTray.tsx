'use client';

/**
 * @fileoverview The sign-in button with its slide-out tray of links.
 *
 * An operator configures, per placement of the `core:auth-button` widget, a
 * short list of links (icon, text, URL, and who sees each), the direction
 * the tray opens, and how transparent it is. This component decides whether
 * the visitor has any links to see and, when they do, takes over the
 * button's click so it opens the tray instead of signing in or navigating to
 * the profile. With no visible links the button behaves exactly as before.
 *
 * A signed-out visitor who can see a link would otherwise lose the only way
 * to sign in, so the tray then starts with a built-in "Sign in" entry.
 *
 * The tray renders in a `<body>` portal at fixed coordinates measured from
 * the button. Every widget zone establishes a size container, which also
 * makes it a stacking context, so a tray drawn inside the header would be
 * painted over by positioned content further down the page.
 *
 * SSR + Live Updates: the links arrive in the server-rendered widget payload
 * and the signed-in state comes from the SSR-seeded session, so the server
 * and the first client render agree on what the button does. The tray itself
 * only exists after a click, so it never takes part in hydration.
 */

import {
    useCallback,
    useEffect,
    useId,
    useLayoutEffect,
    useMemo,
    useRef,
    useState,
    type CSSProperties,
    type KeyboardEvent as ReactKeyboardEvent
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { LogIn } from 'lucide-react';
import type { IAuthButtonLink } from '@/types';
import { MenuNodeIcon } from '../../../../components/layout/MenuNav/MenuNodeIcon';
import { cn } from '../../../../lib/cn';
import { useAuthSession } from '../SessionProvider';
import { useSignInDialog } from '../../hooks';
import { WalletButton } from '../WalletButton';
import styles from './AccountTray.module.scss';

/**
 * Space, in pixels, between the button and the tray, and the least space
 * kept between the tray and the edge of the viewport. Pixels because the
 * value feeds viewport arithmetic on measured rectangles, not a stylesheet.
 */
const TRAY_GAP_PX = 8;

/** Which side of the button the tray actually opened on. */
type TraySide = 'right' | 'down';

/** Viewport coordinates the open tray is fixed at. */
interface ITrayPosition {
    /** Distance from the top of the viewport, in pixels. */
    top: number;
    /** Distance from the left of the viewport, in pixels. */
    left: number;
}

/**
 * Props for {@link AccountTray}.
 */
export interface IAccountTrayProps {
    /** Administrator-chosen image for the button, or null for the text button. */
    imageUrl?: string | null;
    /** Every link the placement configured; the audience filter is applied here. */
    links: IAuthButtonLink[];
    /** Which way the operator asked the tray to open. */
    direction: TraySide;
    /** Opacity of the tray's background as a percentage, from the placement. */
    opacity: number;
}

/**
 * Whether a link should be shown to this visitor.
 *
 * @param link - The configured link, carrying its audience.
 * @param isLoggedIn - Whether the visitor is signed in.
 * @returns True when the link's audience includes the visitor.
 */
function isVisibleTo(link: IAuthButtonLink, isLoggedIn: boolean): boolean {
    let visible = true;
    if (link.audience === 'signed-in') {
        visible = isLoggedIn;
    } else if (link.audience === 'signed-out') {
        visible = !isLoggedIn;
    }
    return visible;
}

/**
 * Work out where the open tray goes.
 *
 * Opening to the right puts the tray beside the button, centred on it
 * vertically. Opening down puts it under the button with its right edge
 * lined up with the button's right edge, because the sign-in button usually
 * sits at the right end of a header; it flips above the button when there is
 * more room there. Both are clamped so the tray never runs off the viewport,
 * where nothing could scroll it back into view.
 *
 * @param side - The side the tray is laid out for.
 * @param anchor - The button's rectangle.
 * @param tray - The tray's rectangle, measured in its current layout.
 * @returns The fixed coordinates for the tray.
 */
function computeTrayPosition(side: TraySide, anchor: DOMRect, tray: DOMRect): ITrayPosition {
    const viewportWidth = document.documentElement.clientWidth;
    const viewportHeight = document.documentElement.clientHeight;
    const maxLeft = viewportWidth - tray.width - TRAY_GAP_PX;
    const maxTop = viewportHeight - tray.height - TRAY_GAP_PX;
    let top: number;
    let left: number;

    if (side === 'right') {
        left = anchor.right + TRAY_GAP_PX;
        top = anchor.top + anchor.height / 2 - tray.height / 2;
    } else {
        const fitsBelow = anchor.bottom + TRAY_GAP_PX + tray.height <= viewportHeight - TRAY_GAP_PX;
        const openAbove = !fitsBelow && anchor.top > viewportHeight - anchor.bottom;
        top = openAbove ? anchor.top - TRAY_GAP_PX - tray.height : anchor.bottom + TRAY_GAP_PX;
        left = anchor.right - tray.width;
    }

    return {
        top: Math.max(TRAY_GAP_PX, Math.min(top, maxTop)),
        left: Math.max(TRAY_GAP_PX, Math.min(left, maxLeft))
    };
}

/**
 * The sign-in / profile button, plus the tray of links it opens when the
 * visitor has any to see.
 *
 * @param props - See {@link IAccountTrayProps}.
 * @returns The button, and the tray while it is open.
 */
export function AccountTray({ imageUrl = null, links, direction, opacity }: IAccountTrayProps) {
    const { isLoggedIn, isPending } = useAuthSession();
    const openSignInDialog = useSignInDialog();
    const trayId = useId();
    const anchorRef = useRef<HTMLSpanElement>(null);
    const trayRef = useRef<HTMLElement>(null);
    const [open, setOpen] = useState(false);
    const [side, setSide] = useState<TraySide>(direction);
    const [position, setPosition] = useState<ITrayPosition | null>(null);

    const visibleLinks = useMemo(
        () => links.filter(link => isVisibleTo(link, isLoggedIn)),
        [links, isLoggedIn]
    );
    // Signing in or out while the tray is open can leave the visitor with no
    // links, so openness is derived rather than trusted from state.
    const trayActive = !isPending && visibleLinks.length > 0;
    const isOpen = open && trayActive;
    const offerSignIn = !isLoggedIn;

    /**
     * Move keyboard focus back to the button, so a keyboard user who leaves
     * the tray lands where they opened it rather than at the end of the page,
     * which is where the portaled tray sits in the document.
     */
    const focusTrigger = useCallback(() => {
        anchorRef.current?.querySelector<HTMLButtonElement>('button')?.focus();
    }, []);

    /**
     * Close the tray and forget where it was placed, so the next open lays it
     * out for the operator's direction again rather than a fallback chosen
     * for a viewport that may since have grown.
     */
    const closeTray = useCallback(() => {
        setOpen(false);
        setSide(direction);
        setPosition(null);
    }, [direction]);

    /**
     * Clear the open state when the visitor loses every link they could see,
     * for example after the session changes in another tab. Without this the
     * tray is only hidden, and it would pop back open on its own, at its old
     * coordinates, the next time the visitor has links to see.
     */
    useEffect(() => {
        if (open && !trayActive) {
            closeTray();
        }
    }, [closeTray, open, trayActive]);

    /**
     * Toggle the tray from the button's click.
     */
    const toggleTray = useCallback(() => {
        if (isOpen) {
            closeTray();
        } else {
            setOpen(true);
        }
    }, [closeTray, isOpen]);

    /**
     * Start sign-in from the tray's built-in entry, closing the tray first so
     * the dialog is the only thing on screen.
     */
    const signInFromTray = useCallback(() => {
        closeTray();
        openSignInDialog();
    }, [closeTray, openSignInDialog]);

    /**
     * Place the open tray before it paints, so it never flashes at the
     * viewport origin. When the operator asked for the right but the
     * viewport has no room there, switch to opening down and measure again,
     * since the tray's shape changes with its layout. Scrolling moves the
     * button, so a captured scroll listener re-places the tray. A change of
     * viewport width can change which side fits, so it closes the tray
     * instead. A change of height alone only re-places it, because mobile
     * browsers fire `resize` whenever the address bar hides or shows during
     * a scroll, and closing then would shut the tray under the visitor.
     */
    useLayoutEffect(() => {
        let cleanup: (() => void) | undefined;
        if (isOpen) {
            const openedWidth = document.documentElement.clientWidth;
            /**
             * Measure the button and the tray and set the tray's coordinates,
             * or change sides when the requested side does not fit.
             */
            const updatePosition = () => {
                const anchor = anchorRef.current?.getBoundingClientRect();
                const tray = trayRef.current?.getBoundingClientRect();
                if (anchor && tray) {
                    const viewportWidth = document.documentElement.clientWidth;
                    const fitsRight = anchor.right + TRAY_GAP_PX + tray.width <= viewportWidth - TRAY_GAP_PX;
                    if (side === 'right' && !fitsRight) {
                        setSide('down');
                    } else {
                        setPosition(computeTrayPosition(side, anchor, tray));
                    }
                }
            };
            /**
             * Close the tray when the viewport width changed since it opened,
             * and otherwise re-place it for the new height.
             */
            const handleResize = () => {
                if (document.documentElement.clientWidth !== openedWidth) {
                    closeTray();
                } else {
                    updatePosition();
                }
            };
            updatePosition();
            window.addEventListener('scroll', updatePosition, true);
            window.addEventListener('resize', handleResize);
            cleanup = () => {
                window.removeEventListener('scroll', updatePosition, true);
                window.removeEventListener('resize', handleResize);
            };
        }
        return cleanup;
    }, [closeTray, isOpen, side]);

    // Keyed on whether the tray has been placed, not on the coordinates, so
    // re-placing it on scroll does not pull focus back to the first entry.
    const isPlaced = position !== null;

    /**
     * Hand keyboard focus to the first entry once the tray is placed. The
     * tray sits at the end of the document, so without this a keyboard user
     * would have to tab past the rest of the page to reach it.
     */
    useEffect(() => {
        if (isOpen && isPlaced) {
            trayRef.current?.querySelector<HTMLElement>('a, button')?.focus();
        }
    }, [isOpen, isPlaced]);

    /**
     * Close the tray when a pointer lands outside both the button and the
     * tray, or when Escape is pressed while focus is still on the button.
     */
    useEffect(() => {
        let cleanup: (() => void) | undefined;
        if (isOpen) {
            /**
             * Dismiss on a press outside the button and the tray.
             *
             * @param event - The document-level pointer event being tested.
             */
            const handlePointerDown = (event: PointerEvent) => {
                const target = event.target as Node;
                const inside = Boolean(anchorRef.current?.contains(target)) || Boolean(trayRef.current?.contains(target));
                if (!inside) {
                    closeTray();
                }
            };
            /**
             * Dismiss on Escape so the tray never traps a keyboard user.
             *
             * @param event - The document-level key event being tested.
             */
            const handleKeyDown = (event: KeyboardEvent) => {
                if (event.key === 'Escape') {
                    closeTray();
                    focusTrigger();
                }
            };
            document.addEventListener('pointerdown', handlePointerDown);
            document.addEventListener('keydown', handleKeyDown);
            cleanup = () => {
                document.removeEventListener('pointerdown', handlePointerDown);
                document.removeEventListener('keydown', handleKeyDown);
            };
        }
        return cleanup;
    }, [closeTray, focusTrigger, isOpen]);

    /**
     * Keyboard movement inside the tray. The arrow keys, Home, and End move
     * between entries. Tabbing past either end closes the tray and returns
     * focus to the button, because the next element after the portaled tray
     * in document order is not anything near the header.
     *
     * @param event - The key event raised inside the tray.
     */
    const handleTrayKeyDown = (event: ReactKeyboardEvent<HTMLElement>) => {
        const entries = Array.from(trayRef.current?.querySelectorAll<HTMLElement>('a, button') ?? []);
        const index = entries.indexOf(document.activeElement as HTMLElement);
        const last = entries.length - 1;
        let next: number | null = null;

        if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
            next = index >= last ? 0 : index + 1;
        } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
            next = index <= 0 ? last : index - 1;
        } else if (event.key === 'Home') {
            next = 0;
        } else if (event.key === 'End') {
            next = last;
        } else if (event.key === 'Tab' && ((event.shiftKey && index <= 0) || (!event.shiftKey && index >= last))) {
            event.preventDefault();
            closeTray();
            focusTrigger();
        }

        if (next !== null) {
            event.preventDefault();
            entries[next]?.focus();
        }
    };

    // The operator's opacity reaches the stylesheet as a custom property;
    // the background colour itself stays a theme token.
    // Typed rather than cast, so the custom property and the standard style
    // fields are both checked by the compiler.
    const trayStyle: CSSProperties & { '--account-tray-opacity': string } = {
        '--account-tray-opacity': `${opacity}%`,
        ...(position ? { top: position.top, left: position.left } : { top: 0, left: 0, visibility: 'hidden' as const })
    };

    const tray = isOpen ? createPortal(
        <nav
            id={trayId}
            ref={trayRef}
            aria-label={isLoggedIn ? 'Account links' : 'Sign in and links'}
            className={cn(styles.tray, side === 'down' ? styles.tray_down : styles.tray_right)}
            style={trayStyle}
            onKeyDown={handleTrayKeyDown}
        >
            <ul className={styles.list}>
                {offerSignIn && (
                    <li className={styles.list_item}>
                        <button type="button" className={cn(styles.entry, styles.entry_signin)} onClick={signInFromTray}>
                            <LogIn size={16} aria-hidden className={styles.entry_icon} />
                            <span className={styles.entry_label}>Sign in</span>
                        </button>
                    </li>
                )}
                {visibleLinks.map((link, index) => {
                    const content = (
                        <>
                            <MenuNodeIcon name={link.icon} size={16} className={styles.entry_icon} />
                            <span className={styles.entry_label}>{link.label}</span>
                        </>
                    );
                    // Root-relative paths navigate client-side; a full URL
                    // leaves the site, which next/link does not handle.
                    return (
                        <li key={`${index}:${link.url}`} className={styles.list_item}>
                            {link.url.startsWith('/') ? (
                                <Link href={link.url} className={styles.entry} onClick={closeTray}>{content}</Link>
                            ) : (
                                <a href={link.url} className={styles.entry} onClick={closeTray}>{content}</a>
                            )}
                        </li>
                    );
                })}
            </ul>
        </nav>,
        document.body
    ) : null;

    return (
        <span ref={anchorRef} className={styles.anchor}>
            <WalletButton
                imageUrl={imageUrl}
                onActivate={trayActive ? toggleTray : undefined}
                expanded={isOpen}
                controlsId={isOpen ? trayId : undefined}
            />
            {tray}
        </span>
    );
}
