'use client';

/**
 * @fileoverview The catalog of widget types an operator can place.
 *
 * The earlier page hid the catalog inside a dropdown in a modal, so an
 * operator could not see what widgets existed, what each one did, or which
 * were already in use, until they had committed to placing one. The library
 * lists every registered type with its description and how many times it is
 * placed, and each entry can be dragged onto a zone (or a layout group) or
 * added with a click. Both gestures open the editor to finish the row; the
 * drag only decides where it lands.
 *
 * @module modules/widgets/components/WidgetLibrary
 */

import { useMemo, useState } from 'react';
import { useDraggable } from '@dnd-kit/core';
import { GripVertical, Plus, Search } from 'lucide-react';
import type { IWidgetTypeSnapshot, IWidgetTypeSnapshotRecord } from '@/types';
import { IconButton } from '../../../../components/ui/IconButton';
import { Input } from '../../../../components/ui/Input';
import { cn } from '../../../../lib/cn';
import { providerLabel } from '../../lib/placementLookup';
import styles from './WidgetLibrary.module.scss';

/** Prefix on the dnd-kit id of a library item, so drag-end can tell it from a row. */
export const LIBRARY_DRAG_PREFIX = 'lib:';

/**
 * Drag data a library item carries.
 */
export interface ILibraryDragData {
    kind: 'library';
    typeId: string;
}

/**
 * Props for the library.
 */
export interface IWidgetLibraryProps {
    /** Registered widget types, grouped by provider. */
    types: IWidgetTypeSnapshot | null;
    /** How many placements each type id currently has. */
    counts: ReadonlyMap<string, number>;
    /** Opens the editor to add a placement of this type. */
    onAdd: (typeId: string) => void;
    /** Whether adding is possible right now (zones and types loaded). */
    disabled: boolean;
}

/**
 * One draggable library entry.
 *
 * @param props.type - The widget type.
 * @param props.count - How many placements use it.
 * @param props.onAdd - Click handler for the add button.
 * @param props.disabled - Whether adding is possible.
 * @returns The entry.
 */
function LibraryItem({ type, count, onAdd, disabled }: {
    type: IWidgetTypeSnapshotRecord;
    count: number;
    onAdd: (typeId: string) => void;
    disabled: boolean;
}) {
    const data: ILibraryDragData = { kind: 'library', typeId: type.id };
    const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
        id: `${LIBRARY_DRAG_PREFIX}${type.id}`,
        data,
        disabled
    });

    return (
        <li ref={setNodeRef} className={cn(styles.item, isDragging && styles['item--dragging'])}>
            <button
                type="button"
                className={styles.handle}
                aria-label={`Drag ${type.label} onto a zone`}
                disabled={disabled}
                {...attributes}
                {...listeners}
            >
                <GripVertical size={16} aria-hidden />
            </button>
            <div className={styles.item_main}>
                <div className={styles.item_headline}>
                    <span className={styles.item_label}>{type.label}</span>
                    {count > 0 && (
                        <span className={styles.item_count} title={`Placed ${count} ${count === 1 ? 'time' : 'times'}`}>
                            ×{count}
                        </span>
                    )}
                </div>
                {type.description && <p className={styles.item_description}>{type.description}</p>}
            </div>
            <IconButton
                size="sm"
                variant="primary"
                aria-label={`Add ${type.label}`}
                title="Add to a zone"
                onClick={() => onAdd(type.id)}
                disabled={disabled}
            >
                <Plus size={16} />
            </IconButton>
        </li>
    );
}

/**
 * The library panel: a search box over every registered type, grouped by
 * provider.
 *
 * @param props - See {@link IWidgetLibraryProps}.
 * @returns The panel.
 */
export function WidgetLibrary({ types, counts, onAdd, disabled }: IWidgetLibraryProps) {
    const [query, setQuery] = useState('');

    const groups = useMemo(() => {
        const needle = query.trim().toLowerCase();
        const result: Array<{ pluginId: string; types: IWidgetTypeSnapshotRecord[] }> = [];
        for (const group of types?.groups ?? []) {
            const matching = group.types.filter(type =>
                needle.length === 0
                || type.label.toLowerCase().includes(needle)
                || type.description.toLowerCase().includes(needle)
                || type.id.toLowerCase().includes(needle));
            if (matching.length > 0) {
                result.push({ pluginId: group.pluginId, types: matching });
            }
        }
        return result;
    }, [types, query]);

    const total = types?.groups.reduce((sum, group) => sum + group.types.length, 0) ?? 0;

    return (
        <section className={styles.library} aria-labelledby="widget-library-heading">
            <div className={styles.header}>
                <h2 id="widget-library-heading" className={styles.title}>Widgets</h2>
                <span className={styles.hint}>Drag one onto a zone, or press add.</span>
            </div>
            {total > 6 && (
                <div className={styles.search}>
                    <Search size={14} aria-hidden className={styles.search_icon} />
                    <Input
                        size="sm"
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Find a widget"
                        aria-label="Find a widget"
                        className={styles.search_input}
                    />
                </div>
            )}
            {groups.length === 0 && (
                <p className={styles.empty}>
                    {total === 0 ? 'No widget types are registered.' : 'No widgets match that search.'}
                </p>
            )}
            {groups.map(group => (
                <div key={group.pluginId} className={styles.group}>
                    <h3 className={styles.group_title}>{providerLabel(group.pluginId)}</h3>
                    <ul className={styles.list}>
                        {group.types.map(type => (
                            <LibraryItem
                                key={type.id}
                                type={type}
                                count={counts.get(type.id) ?? 0}
                                onAdd={onAdd}
                                disabled={disabled}
                            />
                        ))}
                    </ul>
                </div>
            ))}
        </section>
    );
}
