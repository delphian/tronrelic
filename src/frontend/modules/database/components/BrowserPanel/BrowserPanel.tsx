'use client';

/**
 * @fileoverview The card and header row both storage browsers draw around
 * their inventory.
 *
 * The MongoDB and ClickHouse browsers each used to draw their own heading and
 * their own summary line, at different sizes and spacings, one with an icon
 * and one without, so the two looked unrelated when they sat one above the
 * other on a Database tab. Both now render this, which is the core `Panel`
 * with the browser's title and a one-line summary on the title's own row:
 * the database, the prefix every listed name shares, how many collections or
 * tables there are, and their total size.
 *
 * The prefix is stated here because the rows leave it out (see
 * `stripNamePrefix`), so the header is the one place it still appears.
 */

import type { ReactNode } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Panel } from '../../../../components/ui/Panel';
import { formatBytes } from '../../../../lib/format';
import { formatCount } from '../../lib/formatCount';
import styles from './BrowserPanel.module.scss';

/**
 * What a browser's header says about the listing it shows.
 */
export interface IBrowserSummary {
    /** The databases the listing covers. */
    databases: ReadonlyArray<string>;

    /**
     * The prefix every listed name starts with, when the browser is scoped by
     * one. The rows show names without it, so the header states it once.
     */
    prefix?: string;

    /** How many collections or tables are listed. */
    count: number;

    /** The noun for one listed item, such as "collection". */
    singular: string;

    /** The noun for any other number of listed items, such as "collections". */
    plural: string;

    /** Bytes stored across everything listed. */
    totalSize: number;
}

/**
 * Props for the browser panel.
 */
interface IBrowserPanelProps {
    /** The panel's title. In the collapsible form it is also the control that opens the panel. */
    title: string;

    /** Whether the title is a disclosure control that opens and closes the panel. */
    collapsible: boolean;

    /** Whether a collapsible panel is closed. Ignored when `collapsible` is false. */
    collapsed: boolean;

    /** Open or close a collapsible panel. */
    onToggle(): void;

    /**
     * The summary for the header's meta line, or null while it is not known,
     * such as before the statistics have loaded.
     */
    summary: IBrowserSummary | null;

    /** The panel's body. Pass nothing while a collapsible panel is closed. */
    children?: ReactNode;
}

/**
 * Render a storage browser's panel.
 *
 * The heading is an `h3` in both forms. In the collapsible form it holds a
 * button, which is the disclosure markup screen readers announce correctly:
 * the label stays in the document outline, and `aria-expanded` says whether
 * the section beneath it is showing.
 *
 * @param props - Title, disclosure state and handler, summary, and body.
 * @returns The panel.
 */
export function BrowserPanel({ title, collapsible, collapsed, onToggle, summary, children }: IBrowserPanelProps) {
    const heading = collapsible ? (
        <button
            type="button"
            className={styles.disclosure}
            aria-expanded={!collapsed}
            onClick={onToggle}
        >
            {collapsed
                ? <ChevronRight size={16} aria-hidden="true" />
                : <ChevronDown size={16} aria-hidden="true" />}
            {title}
        </button>
    ) : title;

    const meta = summary === null ? undefined : (
        <>
            <span className={styles.identifier}>{summary.databases.join(', ')}</span>
            {summary.prefix && (
                <>
                    {' · '}
                    <span className={styles.identifier}>{`${summary.prefix}*`}</span>
                </>
            )}
            {' · '}
            {formatCount(summary.count, summary.singular, summary.plural)}
            {' · '}
            {formatBytes(summary.totalSize)}
        </>
    );

    return (
        <Panel title={heading} titleAs="h3" meta={meta}>
            {children}
        </Panel>
    );
}
