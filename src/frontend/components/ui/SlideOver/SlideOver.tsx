'use client';

/**
 * @fileoverview Generic right-anchored slide-over panel — the master-detail
 * primitive. A controlled overlay that enters from the right edge while keeping
 * the page behind it visible, so an operator can review one item without losing
 * the list. Rendered through a portal so its stacking escapes the table's
 * overflow/transform contexts; closes on backdrop click or Escape; locks body
 * scroll and hands focus to the panel (restoring it on close) for keyboard and
 * assistive-tech users.
 *
 * Distinct from the centered ModalProvider: that queues transient dialogs
 * imperatively, whereas this is a declarative, single-purpose detail surface
 * whose content stays bound to the caller's current selection.
 */

import { useCallback, useEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { cn } from '../../../lib/cn';
import styles from './SlideOver.module.scss';

/** Width preset for the panel; falls back to a design-constant max-width. */
type SlideOverWidth = 'md' | 'lg';

/** Maps a width preset to its max-width class. */
const widthClass: Record<SlideOverWidth, string> = {
    md: styles['panel--md'],
    lg: styles['panel--lg']
};

/**
 * Controlled right-anchored slide-over.
 *
 * @param props.open - Whether the panel is shown; the parent owns this so the
 *                     content stays bound to the current selection.
 * @param props.onClose - Invoked on backdrop click, the close button, or Escape.
 * @param props.title - Header content (e.g. the selected item's name).
 * @param props.label - Accessible name for the dialog when the title is not plain text.
 * @param props.width - Panel width preset.
 * @param props.children - The panel body (scrolls independently of the header).
 * @returns The portalled overlay, or null while closed / before mount.
 */
export function SlideOver({ open, onClose, title, label, width = 'md', children }: {
    open: boolean;
    onClose: () => void;
    title?: ReactNode;
    label?: string;
    width?: SlideOverWidth;
    children: ReactNode;
}) {
    const [mounted, setMounted] = useState(false);
    const panelRef = useRef<HTMLElement | null>(null);
    const restoreFocusRef = useRef<HTMLElement | null>(null);

    // Portal only after mount so SSR and first client render match — the panel
    // is client-only chrome, never part of the server payload.
    useEffect(() => {
        setMounted(true);
    }, []);

    // While open: lock body scroll, close on Escape, and move focus into the
    // panel, restoring it to the previously focused control on close so a
    // keyboard user returns to where they were.
    useEffect(() => {
        if (!open) {
            return undefined;
        }
        restoreFocusRef.current = document.activeElement as HTMLElement | null;
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panelRef.current?.focus();
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            document.body.style.overflow = previousOverflow;
            restoreFocusRef.current?.focus?.();
        };
    }, [open, onClose]);

    /**
     * Close only when the backdrop itself is clicked, not when the click bubbles
     * up from panel content.
     *
     * @param event - The backdrop mouse event.
     */
    const handleBackdropClick = useCallback((event: MouseEvent<HTMLDivElement>) => {
        if (event.target === event.currentTarget) {
            onClose();
        }
    }, [onClose]);

    return (!mounted || !open) ? null : createPortal(
        <div className={styles.backdrop} onClick={handleBackdropClick}>
            <aside
                ref={panelRef}
                role="dialog"
                aria-modal="true"
                aria-label={label}
                tabIndex={-1}
                className={cn(styles.panel, widthClass[width])}
            >
                <header className={styles.header}>
                    <div className={styles.title}>{title}</div>
                    <button type="button" className={styles.close} aria-label="Close panel" onClick={onClose}>
                        <X size={18} />
                    </button>
                </header>
                <div className={styles.body}>{children}</div>
            </aside>
        </div>,
        document.body
    );
}
