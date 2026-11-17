'use client';

/**
 * @fileoverview The single collapsible-disclosure section for the AI Tools
 * dashboard. The Registry tab's Tools / Variables / System Prompts / Screen
 * Settings sections all render through it, so one disclosure treatment (chevron,
 * `aria-expanded`, section chrome) is shared instead of each surface re-hand-
 * rolling the same toggle. A section shows a one-line summary beside its title
 * whether it is open or not, so an admin can read the registry's shape without
 * expanding everything. Client-only disclosure state — this is an admin
 * surface, not a public-facing component, so no SSR data hydration is involved.
 *
 * The section is a core `Panel`: one card whose header row carries the title
 * and the summary. Being a real card is what lets a table at the end of the
 * section run out to its edges with `<Table flush>`, instead of drawing a
 * second border a few pixels inside a hand-built box. The toggle is a button
 * inside the panel's heading, the usual accordion shape, so a screen reader
 * hears both the heading level and the expanded state.
 */

import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Panel } from '../../../../../../../components/ui/Panel';
import styles from '../page.module.scss';

/**
 * Collapsible disclosure section with a summary beside its title.
 *
 * Disclosure state is uncontrolled by default (the component owns its
 * `useState`), which is all the Registry sections need. A caller whose logic
 * depends on the open state drives it in controlled mode by passing `open` +
 * `onToggle`, keeping that state in the caller while still sharing this
 * component's markup.
 *
 * @param props.title - Section heading.
 * @param props.summary - Compact statistics shown in the header (always visible).
 * @param props.icon - Optional leading glyph rendered after the chevron, before the title.
 * @param props.defaultOpen - Initial open state in uncontrolled mode (default false).
 *   The section an admin opens the tab for passes true, so it needs no click.
 * @param props.open - Controlled open state; when provided, `onToggle` owns changes.
 * @param props.onToggle - Controlled toggle handler, called with the next open state.
 * @param props.children - The section body, rendered only while expanded. A table
 *   that ends the body should pass `flush` so it meets the panel's edges.
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
     * to the internal state otherwise — the one branch that lets this component
     * serve both self-contained sections and a caller that owns the state.
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
        <Panel
            title={
                <button
                    type="button"
                    className={styles.section_toggle}
                    onClick={toggle}
                    aria-expanded={open}
                >
                    {open ? <ChevronDown size={16} aria-hidden /> : <ChevronRight size={16} aria-hidden />}
                    {icon}
                    {title}
                </button>
            }
            meta={summary}
        >
            {open && children}
        </Panel>
    );
}
