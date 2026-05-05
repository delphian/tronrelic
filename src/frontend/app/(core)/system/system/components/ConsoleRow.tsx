'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '../../../../../lib/cn';
import styles from './ConsoleRow.module.scss';

type Status = 'ok' | 'warn' | 'down' | 'idle';

interface Props {
    /** Stable key persisted to localStorage. Must be unique per row. */
    id: string;
    title: string;
    /** Compact monospace summary surfaced in the row header (e.g. "lag 12 · 99.8%"). */
    summary?: ReactNode;
    /** Status dot color. `idle` shows a hollow dot — used for sections with no live state. */
    status?: Status;
    defaultOpen?: boolean;
    children: ReactNode;
}

const STORAGE_KEY_PREFIX = 'system-console-row-open:';

/**
 * Slim collapsible row used by the system console.
 *
 * Replaces the older CollapsibleSection: the header is one short line
 * (status dot + title in caps + monospace summary + chevron) instead of a
 * stacked title-and-subtitle block, cutting collapsed-state height by
 * roughly 60% so an admin can see all five subsystems on one screen.
 *
 * Children only mount when the row is open, preserving the "no API storm
 * on page load" guarantee from the previous design. Open/closed state
 * persists per-row in localStorage; the row starts in the `defaultOpen`
 * state on every render so SSR and the first client paint match.
 */
export function ConsoleRow({ id, title, summary, status = 'idle', defaultOpen = false, children }: Props) {
    const [open, setOpen] = useState(defaultOpen);
    const bodyId = `console-row-${id}`;

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY_PREFIX + id);
            if (stored !== null) {
                setOpen(stored === '1');
            }
        } catch {
            // localStorage unavailable — keep defaultOpen.
        }
    }, [id]);

    const toggle = () => {
        setOpen((prev) => {
            const next = !prev;
            try {
                window.localStorage.setItem(STORAGE_KEY_PREFIX + id, next ? '1' : '0');
            } catch {
                // Quota / access errors — toggle still works in-memory.
            }
            return next;
        });
    };

    return (
        <section id={id} className={cn(styles.row, open && styles.row_open)}>
            <button
                type="button"
                className={styles.header}
                onClick={toggle}
                aria-expanded={open}
                aria-controls={bodyId}
            >
                <span
                    className={cn(
                        styles.dot,
                        status === 'ok' && styles.dot_ok,
                        status === 'warn' && styles.dot_warn,
                        status === 'down' && styles.dot_down,
                        status === 'idle' && styles.dot_idle
                    )}
                    aria-hidden="true"
                />
                <span className={styles.title}>{title}</span>
                {summary && <span className={styles.summary}>{summary}</span>}
                <span className={styles.chevron} aria-hidden="true">
                    {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </span>
            </button>
            {open && (
                <div id={bodyId} className={styles.body}>
                    {children}
                </div>
            )}
        </section>
    );
}
