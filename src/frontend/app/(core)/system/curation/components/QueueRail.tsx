'use client';

/**
 * @fileoverview The list of held items beside the item under review. Choosing a
 * row opens that item in the review sheet in place, so the curator always sees
 * how much is left while working through it. Each row carries enough to tell
 * two items of the same type apart: the title, the first lines of the text,
 * which plugin sent it, and how long it has waited.
 *
 * Presentation only. The Pending tab owns the list, the selection, and what
 * happens after a decision. Like the ai-tools conversation rail, it sits at the
 * bottom of the type scale because it is an index to scan, not reading
 * material, and must not compete with the content in the sheet beside it.
 */

import { Inbox } from 'lucide-react';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { cn } from '../../../../../lib/cn';
import type { ICurationItemView } from '../../../../../modules/curation';
import styles from './QueueRail.module.scss';

/** Props for {@link QueueRail}. */
export interface IQueueRailProps {
    /** Held items, newest first, as the queue endpoint returns them. */
    items: ICurationItemView[];
    /** The item open in the review sheet, so its row reads as selected. */
    selectedId: string | null;
    /** Open an item in the review sheet. */
    onSelect: (id: string) => void;
}

/**
 * Collapse an item's body to a single run of text for the two-line snippet,
 * so line breaks in a draft do not waste the row's limited height.
 *
 * @param item - The held item.
 * @returns The body with whitespace collapsed, or an empty string.
 */
function snippetOf(item: ICurationItemView): string {
    return (item.preview.body ?? '').replace(/\s+/g, ' ').trim();
}

/**
 * The queue list beside the review sheet.
 *
 * @param props - See {@link IQueueRailProps}.
 * @returns The rail.
 */
export function QueueRail({ items, selectedId, onSelect }: IQueueRailProps) {
    return (
        <aside className={styles.rail} aria-label="Items waiting for review">
            <div className={styles.header}>
                <span className={styles.title}>
                    <Inbox size={16} aria-hidden="true" /> Waiting for review
                </span>
                <span className={styles.count}>{items.length}</span>
            </div>

            <ul className={styles.list}>
                {items.map(item => {
                    const isActive = item.id === selectedId;
                    const snippet = snippetOf(item);
                    return (
                        <li key={item.id}>
                            <button
                                type="button"
                                className={cn(styles.row, isActive && styles.row_active)}
                                aria-current={isActive ? 'true' : undefined}
                                onClick={() => onSelect(item.id)}
                            >
                                <span className={styles.row_title}>{item.preview.title ?? item.typeId}</span>
                                {snippet && <span className={styles.row_snippet}>{snippet}</span>}
                                <span className={styles.row_meta}>
                                    <span className={styles.row_provider}>{item.providerId}</span>
                                    <ClientTime date={item.createdAt} format="relative" />
                                </span>
                            </button>
                        </li>
                    );
                })}
            </ul>
        </aside>
    );
}
