'use client';

/**
 * @fileoverview A titled, collapsible section for the Registry tab. Both the
 * Tools and Variables sections default collapsed and show a one-line summary in
 * the header, so the registry opens compact and an admin expands only the part
 * they came for. Client-only disclosure state — this is an admin surface, not a
 * public-facing component, so no SSR data hydration is involved.
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import styles from '../page.module.scss';

/**
 * Collapsible disclosure section with a summary shown while collapsed.
 *
 * @param props.title - Section heading.
 * @param props.summary - Compact statistics shown in the header (always visible).
 * @param props.defaultOpen - Whether the section starts expanded (default false).
 * @param props.children - The section body, rendered only while expanded.
 * @returns The section.
 */
export function CollapsibleSection({
    title,
    summary,
    defaultOpen = false,
    children
}: {
    title: string;
    summary?: ReactNode;
    defaultOpen?: boolean;
    children: ReactNode;
}) {
    const [open, setOpen] = useState(defaultOpen);

    return (
        <div className={styles.section}>
            <button
                type="button"
                className={styles.section_header}
                onClick={() => setOpen(current => !current)}
                aria-expanded={open}
            >
                {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                <span className={styles.section_title}>{title}</span>
                {summary !== undefined && <span className={styles.section_summary}>{summary}</span>}
            </button>
            {open && <div className={styles.section_body}>{children}</div>}
        </div>
    );
}
