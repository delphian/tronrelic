'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Card } from '../../../../../components/ui/Card';
import styles from './CollapsibleSection.module.scss';

interface Props {
    /** Stable key persisted to localStorage. Must be unique per section. */
    id: string;
    title: string;
    subtitle?: string;
    icon?: ReactNode;
    /** Initial state used during SSR and before localStorage is read. */
    defaultOpen?: boolean;
    children: ReactNode;
}

const STORAGE_KEY_PREFIX = 'system-section-open:';

/**
 * Collapsible section wrapper for the System admin page.
 *
 * Children are only rendered when the section is open, which means each
 * section's own `useEffect` polling does not fire until the user expands
 * it — preventing an API storm when /system/system loads. Open/closed
 * state persists per-section in localStorage so an admin's preferred
 * layout sticks across visits.
 *
 * The component starts closed (or `defaultOpen`) on every render so SSR
 * and the first client paint match; the persisted state is applied in a
 * post-mount effect, which can promote a section to open without a
 * hydration mismatch.
 */
export function CollapsibleSection({ id, title, subtitle, icon, defaultOpen = false, children }: Props) {
    const [open, setOpen] = useState(defaultOpen);
    const bodyId = `system-section-${id}`;

    useEffect(() => {
        try {
            const stored = window.localStorage.getItem(STORAGE_KEY_PREFIX + id);
            if (stored !== null) {
                setOpen(stored === '1');
            }
        } catch {
            // localStorage unavailable (e.g. privacy mode) — keep defaultOpen.
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
        <Card padding="lg">
            <button
                type="button"
                className={styles.header}
                onClick={toggle}
                aria-expanded={open}
                aria-controls={bodyId}
            >
                {icon && <span className={styles.header_icon}>{icon}</span>}
                <span className={styles.header_text}>
                    <span className={styles.title}>{title}</span>
                    {subtitle && <span className={styles.subtitle}>{subtitle}</span>}
                </span>
                <span className={styles.chevron} aria-hidden="true">
                    {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                </span>
            </button>
            {open && (
                <div id={bodyId} className={styles.body}>
                    {children}
                </div>
            )}
        </Card>
    );
}
