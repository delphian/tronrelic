'use client';

/**
 * @fileoverview One zone on the placement board.
 *
 * A zone is a physical slot in the page layout. The board shows it as a
 * card: what the zone is and where it renders, a strip depicting how the
 * widgets on the current page will be arranged, the widgets themselves as
 * reorderable rows (with a layout group's children nested under it), and a
 * disclosure for widgets placed here that belong to other pages, so nothing
 * placed in the zone is ever hidden by the page filter. The zone's own
 * layout controls sit behind a toggle in the header, since tuning a zone's
 * arrangement is an occasional task and seven selects per zone drowned the
 * rows on the earlier page.
 *
 * @module modules/widgets/components/ZoneBoard
 */

import { Fragment, useMemo, useState } from 'react';
import { useDroppable } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { ChevronDown, ChevronUp, Info, Plus, SlidersHorizontal } from 'lucide-react';
import type { IWidgetPlacement, IWidgetTypeSnapshot, IZoneLayoutConfig, IZoneSnapshotRecord } from '@/types';
import { Button } from '../../../../components/ui/Button';
import { Tooltip } from '../../../../components/ui/Tooltip';
import { cn } from '../../../../lib/cn';
import { layoutIsRow, presetLabel, toLayoutConfig } from '../../lib/layoutPresets';
import { LAYOUT_GROUP_TYPE_ID, findWidgetType, placementLabel, providerLabel } from '../../lib/placementLookup';
import { PlacementRow } from '../PlacementRow';
import { ZoneLayoutControls } from '../LayoutConfigControls';
import { ZoneLayoutStrip, type IStripItem } from '../ZoneLayoutStrip';
import styles from './ZoneBoard.module.scss';

/**
 * Props for a zone board.
 */
export interface IZoneBoardProps {
    /** The zone, with its effective layout. */
    zone: IZoneSnapshotRecord;
    /** Every placement targeting this zone, on any page. */
    placements: IWidgetPlacement[];
    /** Widget-type snapshot for labels and providers. */
    types: IWidgetTypeSnapshot | null;
    /** Row with a write in flight, if any. */
    busyId: string | null;
    /** Whether the editor is scoped to a page rather than site-wide. */
    pageScoped: boolean;
    /** Whether a top-level row belongs to the current page view. */
    placementInView: (placement: IWidgetPlacement) => boolean;
    onToggleEnabled: (placement: IWidgetPlacement, next: boolean) => void;
    onEdit: (placement: IWidgetPlacement) => void;
    onSetWidth: (placement: IWidgetPlacement, weight: number | null) => void;
    onLayoutChange: (zoneId: string, config: IZoneLayoutConfig) => void;
    onMoveWithinList: (placement: IWidgetPlacement, direction: 'up' | 'down') => void;
    onMoveOutOfGroup: (placement: IWidgetPlacement) => void;
    /** Opens the editor to add a widget to this zone. */
    onAddWidget: (zoneId: string) => void;
}

/**
 * Thin top-level drop rail between rows. A layout group's children region
 * owns the space directly under its container, so without a dedicated rail
 * there is nowhere to land a widget above or below the group at the zone
 * level. The workbench's collision strategy returns this rail whenever the
 * pointer is inside it. Its data is anchored by the row it precedes (null
 * for the trailing rail, meaning append).
 *
 * @param props.zoneId - Zone this rail inserts into.
 * @param props.beforeId - Row this rail precedes, or null to append.
 * @returns The rail.
 */
function GapRail({ zoneId, beforeId }: { zoneId: string; beforeId: string | null }) {
    const { setNodeRef, isOver } = useDroppable({
        id: `gap:${zoneId}:${beforeId ?? 'end'}`,
        data: { kind: 'gap', zoneId, beforeId }
    });
    return <div ref={setNodeRef} className={cn(styles.gap_rail, isOver && styles['gap_rail--active'])} aria-hidden />;
}

/**
 * Props for a layout group's children region.
 */
interface IGroupDropAreaProps {
    container: IWidgetPlacement;
    zoneId: string;
    childPlacements: IWidgetPlacement[];
    types: IWidgetTypeSnapshot | null;
    busyId: string | null;
    showWidth: boolean;
    onToggleEnabled: IZoneBoardProps['onToggleEnabled'];
    onEdit: IZoneBoardProps['onEdit'];
    onSetWidth: IZoneBoardProps['onSetWidth'];
    onMoveWithinList: IZoneBoardProps['onMoveWithinList'];
    onMoveOutOfGroup: IZoneBoardProps['onMoveOutOfGroup'];
}

/**
 * Droppable, sortable region holding a layout group's children. Keyed
 * `group:<id>` so a drop anywhere in it, including an empty group, nests
 * the widget; hosts its own sortable context so children reorder
 * independently of the zone's top-level list.
 *
 * @param props - See {@link IGroupDropAreaProps}.
 * @returns The region.
 */
function GroupDropArea({
    container,
    zoneId,
    childPlacements,
    types,
    busyId,
    showWidth,
    onToggleEnabled,
    onEdit,
    onSetWidth,
    onMoveWithinList,
    onMoveOutOfGroup
}: IGroupDropAreaProps) {
    const { setNodeRef, isOver } = useDroppable({
        id: `group:${container.id}`,
        data: { containerId: container.id, zoneId }
    });
    const childIds = useMemo(() => childPlacements.map(child => child.id), [childPlacements]);

    return (
        <div ref={setNodeRef} className={cn(styles.group_area, isOver && styles['group_area--drop_target'])}>
            <SortableContext id={`group:${container.id}`} items={childIds} strategy={verticalListSortingStrategy}>
                {childPlacements.length === 0 ? (
                    <span className={styles.group_empty}>Empty group. Drag a widget here to put it inside.</span>
                ) : childPlacements.map((child, index) => (
                    <PlacementRow
                        key={child.id}
                        placement={child}
                        label={placementLabel(child, types)}
                        provider={providerFor(child, types)}
                        busy={busyId === child.id}
                        nested
                        showWidth={showWidth}
                        pageScoped={false}
                        isFirst={index === 0}
                        isLast={index === childPlacements.length - 1}
                        onMoveUp={() => onMoveWithinList(child, 'up')}
                        onMoveDown={() => onMoveWithinList(child, 'down')}
                        onMoveOut={() => onMoveOutOfGroup(child)}
                        onToggleEnabled={onToggleEnabled}
                        onEdit={onEdit}
                        onSetWidth={onSetWidth}
                    />
                ))}
            </SortableContext>
        </div>
    );
}

/**
 * The provider label for a row, or null when its type is not registered
 * right now (its plugin is disabled), which the row shows as a warning.
 *
 * @param placement - The row.
 * @param types - Widget-type snapshot.
 * @returns The provider label or null.
 */
function providerFor(placement: IWidgetPlacement, types: IWidgetTypeSnapshot | null): string | null {
    const type = findWidgetType(types, placement.typeId);
    return type ? providerLabel(type.pluginId) : null;
}

/**
 * Where a zone renders, in operator terms, from its host.
 *
 * @param host - The zone's host track.
 * @returns A short phrase for the header.
 */
function reachLabel(host: IZoneSnapshotRecord['host']): string {
    let label = 'Admin pages';
    if (host === 'site') label = 'Every page';
    if (host === 'core') label = 'Core pages';
    if (host === 'plugin') label = 'Plugin pages';
    return label;
}

/**
 * One zone card.
 *
 * @param props - See {@link IZoneBoardProps}.
 * @returns The card.
 */
export function ZoneBoard({
    zone,
    placements,
    types,
    busyId,
    pageScoped,
    placementInView,
    onToggleEnabled,
    onEdit,
    onSetWidth,
    onLayoutChange,
    onMoveWithinList,
    onMoveOutOfGroup,
    onAddWidget
}: IZoneBoardProps) {
    const { setNodeRef, isOver } = useDroppable({ id: zone.id, data: { zoneId: zone.id } });
    const [layoutOpen, setLayoutOpen] = useState(false);

    // Split the zone's rows into the top-level list for this page, the
    // children of every layout group, and the top-level rows that belong
    // to other pages.
    const { topLevel, offPage, childrenByParent } = useMemo(() => {
        const inView: IWidgetPlacement[] = [];
        const elsewhere: IWidgetPlacement[] = [];
        const map = new Map<string, IWidgetPlacement[]>();
        for (const placement of placements) {
            if (placement.parentId) {
                const bucket = map.get(placement.parentId) ?? [];
                bucket.push(placement);
                map.set(placement.parentId, bucket);
            } else if (placementInView(placement)) {
                inView.push(placement);
            } else {
                elsewhere.push(placement);
            }
        }
        for (const bucket of map.values()) bucket.sort((a, b) => a.order - b.order);
        inView.sort((a, b) => a.order - b.order);
        elsewhere.sort((a, b) => a.order - b.order);
        return { topLevel: inView, offPage: elsewhere, childrenByParent: map };
    }, [placements, placementInView]);

    const itemIds = useMemo(() => topLevel.map(p => p.id), [topLevel]);
    const offPageIds = useMemo(() => offPage.map(p => p.id), [offPage]);
    const zoneIsRow = layoutIsRow(zone.layoutConfig);

    // The strip depicts what actually renders: enabled rows on this page,
    // with each group's enabled children drawn inside it.
    const stripItems = useMemo((): IStripItem[] => {
        /**
         * Map one row to a strip item, recursing into a layout group.
         *
         * @param placement - The row.
         * @returns The strip item.
         */
        const toItem = (placement: IWidgetPlacement): IStripItem => {
            const item: IStripItem = {
                id: placement.id,
                label: placementLabel(placement, types),
                weight: placement.layoutWeight
            };
            if (placement.typeId === LAYOUT_GROUP_TYPE_ID) {
                item.layout = toLayoutConfig(placement.instanceConfig);
                item.children = (childrenByParent.get(placement.id) ?? []).filter(c => c.enabled).map(toItem);
            }
            return item;
        };
        return topLevel.filter(p => p.enabled).map(toItem);
    }, [topLevel, childrenByParent, types]);

    const hiddenCount = topLevel.filter(p => !p.enabled).length;

    return (
        <section
            className={cn(styles.zone, isOver && styles['zone--drop_target'])}
            aria-labelledby={`zone-${zone.id}-title`}
        >
            <header className={styles.header}>
                <div className={styles.identity}>
                    <h3 id={`zone-${zone.id}-title`} className={styles.title}>{zone.label}</h3>
                    <Tooltip content={zone.description}>
                        <span className={styles.info} tabIndex={0} aria-label={`About ${zone.label}: ${zone.description}`}>
                            <Info size={14} aria-hidden />
                        </span>
                    </Tooltip>
                    <span className={styles.reach}>{reachLabel(zone.host)}</span>
                </div>
                <div className={styles.header_actions}>
                    <button
                        type="button"
                        className={cn(styles.layout_toggle, layoutOpen && styles['layout_toggle--open'])}
                        onClick={() => setLayoutOpen(open => !open)}
                        aria-expanded={layoutOpen}
                        aria-label={`${layoutOpen ? 'Hide' : 'Show'} layout settings for ${zone.label}`}
                    >
                        <SlidersHorizontal size={14} aria-hidden />
                        <span>{presetLabel(zone.layoutConfig)}</span>
                        {layoutOpen ? <ChevronUp size={14} aria-hidden /> : <ChevronDown size={14} aria-hidden />}
                    </button>
                    <Button variant="ghost" size="xs" icon={<Plus size={14} />} onClick={() => onAddWidget(zone.id)}>
                        Add widget
                    </Button>
                </div>
            </header>

            {layoutOpen && (
                <div className={styles.layout_panel}>
                    <ZoneLayoutControls
                        zoneId={zone.id}
                        layout={zone.layoutConfig}
                        disabled={busyId !== null}
                        onChange={onLayoutChange}
                    />
                </div>
            )}

            {stripItems.length > 0 && (
                <div className={styles.strip}>
                    <ZoneLayoutStrip
                        layout={zone.layoutConfig}
                        items={stripItems}
                        onSelect={(id) => {
                            const target = placements.find(p => p.id === id);
                            if (target) onEdit(target);
                        }}
                        label={`How ${zone.label} arranges its widgets`}
                    />
                    {hiddenCount > 0 && (
                        <span className={styles.strip_note}>
                            {hiddenCount} turned off and not drawn.
                        </span>
                    )}
                </div>
            )}

            <SortableContext id={zone.id} items={itemIds} strategy={verticalListSortingStrategy}>
                <div ref={setNodeRef} className={styles.rows}>
                    {topLevel.length === 0 ? (
                        <p className={styles.empty}>
                            {pageScoped
                                ? 'Nothing renders here on this page. Drag a widget from the library or press Add widget.'
                                : 'No site-wide widgets here. Drag a widget from the library or press Add widget.'}
                        </p>
                    ) : (
                        <>
                            {topLevel.map((placement, index) => {
                                const isContainer = placement.typeId === LAYOUT_GROUP_TYPE_ID;
                                const children = isContainer ? childrenByParent.get(placement.id) ?? [] : [];
                                return (
                                    <Fragment key={placement.id}>
                                        <GapRail zoneId={zone.id} beforeId={placement.id} />
                                        <PlacementRow
                                            placement={placement}
                                            label={placementLabel(placement, types)}
                                            provider={providerFor(placement, types)}
                                            busy={busyId === placement.id}
                                            nested={false}
                                            showWidth={zoneIsRow}
                                            pageScoped={pageScoped}
                                            isFirst={index === 0}
                                            isLast={index === topLevel.length - 1}
                                            onMoveUp={() => onMoveWithinList(placement, 'up')}
                                            onMoveDown={() => onMoveWithinList(placement, 'down')}
                                            onToggleEnabled={onToggleEnabled}
                                            onEdit={onEdit}
                                            onSetWidth={onSetWidth}
                                        />
                                        {isContainer && (
                                            <GroupDropArea
                                                container={placement}
                                                zoneId={zone.id}
                                                childPlacements={children}
                                                types={types}
                                                busyId={busyId}
                                                showWidth={layoutIsRow(toLayoutConfig(placement.instanceConfig))}
                                                onToggleEnabled={onToggleEnabled}
                                                onEdit={onEdit}
                                                onSetWidth={onSetWidth}
                                                onMoveWithinList={onMoveWithinList}
                                                onMoveOutOfGroup={onMoveOutOfGroup}
                                            />
                                        )}
                                    </Fragment>
                                );
                            })}
                            <GapRail zoneId={zone.id} beforeId={null} />
                        </>
                    )}
                </div>
            </SortableContext>

            {offPage.length > 0 && (
                <details className={styles.elsewhere}>
                    <summary className={styles.elsewhere_summary}>
                        {offPage.length} more placed here {pageScoped ? 'on other pages' : 'on particular pages only'}
                    </summary>
                    <SortableContext id={`elsewhere:${zone.id}`} items={offPageIds} strategy={verticalListSortingStrategy}>
                        <div className={styles.elsewhere_rows}>
                            {offPage.map(placement => (
                                <PlacementRow
                                    key={placement.id}
                                    placement={placement}
                                    label={placementLabel(placement, types)}
                                    provider={providerFor(placement, types)}
                                    busy={busyId === placement.id}
                                    nested={false}
                                    showWidth={false}
                                    pageScoped
                                    offPage
                                    isFirst
                                    isLast
                                    onMoveUp={() => undefined}
                                    onMoveDown={() => undefined}
                                    onToggleEnabled={onToggleEnabled}
                                    onEdit={onEdit}
                                    onSetWidth={onSetWidth}
                                />
                            ))}
                        </div>
                    </SortableContext>
                </details>
            )}
        </section>
    );
}
