'use client';

/**
 * @fileoverview The single collapsible-disclosure primitive for the AI Tools
 * dashboard. The Registry tab's Tools / Variables / System Prompts / Screen
 * Settings sections and the Query tab's Saved Prompts panel all render through it,
 * so one disclosure treatment (chevron, `aria-expanded`, section chrome) is shared
 * instead of each surface re-hand-rolling the same toggle. Sections default
 * collapsed and show a one-line summary in the header, so the registry opens
 * compact and an admin expands only the part they came for. Client-only disclosure
 * state — this is an admin surface, not a public-facing component, so no SSR data
 * hydration is involved.
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import styles from '../page.module.scss';

/**
 * Collapsible disclosure section with a summary shown while collapsed.
 *
 * Disclosure state is uncontrolled by default (the component owns its `useState`),
 * which is all the Registry sections need. A caller whose logic depends on the
 * open state — the Saved Prompts panel lazy-loads its list and polls schedules
 * only while open — drives it in controlled mode by passing `open` + `onToggle`,
 * keeping that state in the caller while still sharing this component's markup.
 *
 * @param props.title - Section heading.
 * @param props.summary - Compact statistics shown in the header (always visible).
 * @param props.icon - Optional leading glyph rendered after the chevron, before the title.
 * @param props.defaultOpen - Initial open state in uncontrolled mode (default false).
 * @param props.open - Controlled open state; when provided, `onToggle` owns changes.
 * @param props.onToggle - Controlled toggle handler, called with the next open state.
 * @param props.children - The section body, rendered only while expanded.
 * @returns The section.
 */
export function CollapsibleSection({
    title,
    summary,
    icon,
    defaultOpen = false,
    open: controlledOpen,
    onToggle,
    children
}: {
    title: string;
    summary?: ReactNode;
    icon?: ReactNode;
    defaultOpen?: boolean;
    open?: boolean;
    onToggle?: (next: boolean) => void;
    children: ReactNode;
}) {
    const [uncontrolledOpen, setUncontrolledOpen] = useState(defaultOpen);
    const isControlled = controlledOpen !== undefined;
    const open = isControlled ? controlledOpen : uncontrolledOpen;

    /**
     * Flip the disclosure, routing the change to the caller in controlled mode or
     * to the internal state otherwise — the one branch that makes this component
     * serve both the self-contained Registry sections and the state-owning Saved
     * Prompts panel.
     */
    const toggle = (): void => {
        const next = !open;
        if (isControlled) {
            onToggle?.(next);
        } else {
            setUncontrolledOpen(next);
        }
    };

    return (
        <div className={styles.section}>
            <button
                type="button"
                className={styles.section_header}
                onClick={toggle}
                aria-expanded={open}
            >
                {open ? <ChevronDown size={18} /> : <ChevronRight size={18} />}
                {icon}
                <span className={styles.section_title}>{title}</span>
                {summary !== undefined && <span className={styles.section_summary}>{summary}</span>}
            </button>
            {open && <div className={styles.section_body}>{children}</div>}
        </div>
    );
}
