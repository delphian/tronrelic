'use client';

/**
 * @fileoverview One placed widget in a zone.
 *
 * A row carries only what an operator decides at a glance: what the widget
 * is, whether it is on, where it shows, and the handful of inline actions
 * that need no form (reorder, width, on/off). Everything else, including
 * removal and restoring plugin defaults, lives in the editor panel, so the
 * row stays readable in a zone with a dozen widgets. Top-level rows and
 * rows nested in a layout group share this component; nesting changes only
 * the drag data and the extra "move out" action.
 *
 * @module modules/widgets/components/PlacementRow
 */

import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ArrowDown, ArrowUp, Boxes, GripVertical, Pencil, Ungroup } from 'lucide-react';
import type { IWidgetPlacement } from '@/types';
import { Badge } from '../../../../components/ui/Badge';
import { IconButton } from '../../../../components/ui/IconButton';
import { Select } from '../../../../components/ui/Select';
import { Switch } from '../../../../components/ui/Switch';
import { cn } from '../../../../lib/cn';
import { LAYOUT_GROUP_TYPE_ID } from '../../lib/placementLookup';
import { WIDTH_OPTIONS } from '../../lib/layoutPresets';
import styles from './PlacementRow.module.scss';

/**
 * Props for a placement row.
 */
export interface IPlacementRowProps {
    /** The row. */
    placement: IWidgetPlacement;
    /** Display name: the operator title or the widget type label. */
    label: string;
    /** Who provides the widget type, or null when the type is not registered right now. */
    provider: string | null;
    /** Whether a write for this row is in flight. */
    busy: boolean;
    /** Whether the row is nested in a layout group. */
    nested: boolean;
    /** Whether the row's container arranges rows side by side, so width applies. */
    showWidth: boolean;
    /** Whether the editor is scoped to a page, so a site-wide row should say so. */
    pageScoped: boolean;
    /** Whether the row is off the current page and shown for reference only. */
    offPage?: boolean;
    /** First in its list, so "move up" is disabled. */
    isFirst: boolean;
    /** Last in its list, so "move down" is disabled. */
    isLast: boolean;
    onMoveUp: () => void;
    onMoveDown: () => void;
    /** Present only for nested rows: promote to the zone top level. */
    onMoveOut?: () => void;
    onToggleEnabled: (placement: IWidgetPlacement, next: boolean) => void;
    onEdit: (placement: IWidgetPlacement) => void;
    onSetWidth: (placement: IWidgetPlacement, weight: number | null) => void;
}

/**
 * A draggable placement row.
 *
 * @param props - See {@link IPlacementRowProps}.
 * @returns The row.
 */
export function PlacementRow({
    placement,
    label,
    provider,
    busy,
    nested,
    showWidth,
    pageScoped,
    offPage = false,
    isFirst,
    isLast,
    onMoveUp,
    onMoveDown,
    onMoveOut,
    onToggleEnabled,
    onEdit,
    onSetWidth
}: IPlacementRowProps) {
    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
        id: placement.id,
        disabled: offPage,
        data: nested
            ? { zoneId: placement.zoneId, parentId: placement.parentId }
            : { zoneId: placement.zoneId }
    });
    const style = { transform: CSS.Transform.toString(transform), transition };
    const isGroup = placement.typeId === LAYOUT_GROUP_TYPE_ID;
    const widthValue = placement.layoutWeight !== undefined ? String(placement.layoutWeight) : '';

    return (
        <div
            ref={setNodeRef}
            style={style}
            className={cn(
                styles.row,
                !placement.enabled && styles['row--off'],
                offPage && styles['row--off_page'],
                isDragging && styles['row--dragging']
            )}
        >
            {offPage ? (
                <span className={styles.handle_placeholder} aria-hidden />
            ) : (
                <button
                    type="button"
                    className={styles.handle}
                    aria-label={nested ? `Drag ${label} to reorder or move it out of the group` : `Drag ${label} to reorder`}
                    {...attributes}
                    {...listeners}
                >
                    <GripVertical size={16} aria-hidden />
                </button>
            )}

            <div className={styles.main}>
                <div className={styles.headline}>
                    {isGroup && <Boxes size={14} aria-hidden className={styles.group_icon} />}
                    <button type="button" className={styles.name} onClick={() => onEdit(placement)}>
                        {label}
                    </button>
                    {!placement.enabled && <Badge tone="neutral" size="xs">Off</Badge>}
                    {placement.source === 'plugin' && (
                        <span className={styles.meta} title="Placed by the plugin that provides it">
                            placed by {placement.pluginId ?? 'a plugin'}
                        </span>
                    )}
                    {placement.source !== 'plugin' && provider && !isGroup && (
                        <span className={styles.meta}>{provider}</span>
                    )}
                    {!provider && (
                        <Badge tone="warning" size="xs">Widget unavailable</Badge>
                    )}
                </div>
                {!nested && (placement.routes.length > 0 || pageScoped) && (
                    <div className={styles.routes}>
                        {placement.routes.length === 0
                            ? <span className={styles.routes_all}>every page</span>
                            : placement.routes.map(route => (
                                <code key={route} className={styles.route}>{route}</code>
                            ))}
                    </div>
                )}
            </div>

            <div className={styles.actions}>
                {showWidth && !offPage && (
                    <Select
                        size="xs"
                        className={styles.width}
                        value={widthValue}
                        disabled={busy}
                        aria-label={`Relative width for ${label}`}
                        title="Relative width in a side-by-side arrangement"
                        onChange={(e) => onSetWidth(placement, e.target.value === '' ? null : Number(e.target.value))}
                    >
                        {WIDTH_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                    </Select>
                )}
                <Switch
                    size="sm"
                    on={placement.enabled}
                    onChange={(next) => onToggleEnabled(placement, next)}
                    disabled={busy}
                    aria-label={`${placement.enabled ? 'Turn off' : 'Turn on'} ${label}`}
                />
                {!offPage && (
                    <span className={styles.reorder}>
                        <IconButton
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${label} up`}
                            onClick={onMoveUp}
                            disabled={busy || isFirst}
                        >
                            <ArrowUp size={14} />
                        </IconButton>
                        <IconButton
                            size="sm"
                            variant="ghost"
                            aria-label={`Move ${label} down`}
                            onClick={onMoveDown}
                            disabled={busy || isLast}
                        >
                            <ArrowDown size={14} />
                        </IconButton>
                        {onMoveOut && (
                            <IconButton
                                size="sm"
                                variant="ghost"
                                aria-label={`Move ${label} out of the group`}
                                onClick={onMoveOut}
                                disabled={busy}
                            >
                                <Ungroup size={14} />
                            </IconButton>
                        )}
                    </span>
                )}
                <IconButton
                    size="sm"
                    variant="primary"
                    aria-label={`Edit ${label}`}
                    onClick={() => onEdit(placement)}
                >
                    <Pencil size={14} />
                </IconButton>
            </div>
        </div>
    );
}
