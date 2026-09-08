'use client';

/**
 * @fileoverview A schematic of how a zone will lay its widgets out.
 *
 * A zone's arrangement, gap, and per-row widths are invisible in a list of
 * rows: an operator sets "row, spread out" and 2× and has to open the live
 * page to see what that produced. The strip draws the zone as a miniature
 * flex container, driven by the same config the renderer applies, so a
 * layout change is visible where it is made. Only the widgets that would
 * render on the current page are drawn, and each block is a button that
 * opens that widget in the editor, so the strip is also the fastest way to
 * reach a row.
 *
 * @module modules/widgets/components/ZoneLayoutStrip
 */

import type { CSSProperties } from 'react';
import type { IZoneLayoutConfig } from '@/types';
import { cn } from '../../../../lib/cn';
import styles from './ZoneLayoutStrip.module.scss';

/**
 * One block in the strip. A layout group carries its own `layout` and
 * `children`, drawn as a nested container.
 */
export interface IStripItem {
    /** Placement id, handed back on click. */
    id: string;
    /** Text drawn in the block. */
    label: string;
    /** Relative width as a flex weight; absent means natural width. */
    weight?: number;
    /** A layout group's own arrangement. */
    layout?: IZoneLayoutConfig;
    /** A layout group's nested items. */
    children?: IStripItem[];
}

/**
 * Props for the strip.
 */
export interface IZoneLayoutStripProps {
    /** The container's arrangement. */
    layout: IZoneLayoutConfig;
    /** The items to draw, in render order. */
    items: IStripItem[];
    /** Opens the clicked widget in the editor. */
    onSelect: (id: string) => void;
    /** Accessible description of what the strip depicts. */
    label: string;
}

/**
 * Map a token gap size to the gap token the strip uses. The strip is a
 * miniature, so each size steps down one rung from what the live zone
 * uses; the relative difference is what the operator is comparing.
 *
 * @param gap - The layout's gap size.
 * @returns A CSS value referencing a gap token.
 */
function stripGap(gap: IZoneLayoutConfig['gap']): string {
    let value = 'var(--gap-xs)';
    if (gap === 'none') value = '0';
    if (gap === 'md') value = 'var(--gap-sm)';
    if (gap === 'lg') value = 'var(--gap-md)';
    return value;
}

/**
 * Build the custom properties the container class reads.
 *
 * @param layout - The arrangement to depict.
 * @returns Inline style carrying the flex values.
 */
function containerStyle(layout: IZoneLayoutConfig): CSSProperties {
    return {
        '--strip-direction': layout.flexDirection,
        '--strip-justify': layout.justifyContent,
        '--strip-align': layout.alignItems,
        '--strip-wrap': layout.flexWrap,
        '--strip-gap': stripGap(layout.gap)
    } as CSSProperties;
}

/**
 * Build the flex-item style for one block.
 *
 * @param weight - The item's relative width, if any.
 * @returns Inline style carrying the grow weight, or undefined.
 */
function itemStyle(weight: number | undefined): CSSProperties | undefined {
    return typeof weight === 'number' ? ({ '--strip-grow': weight } as CSSProperties) : undefined;
}

/**
 * Draw one list of items inside a flex container.
 *
 * @param props.layout - The container's arrangement.
 * @param props.items - Items to draw.
 * @param props.onSelect - Click handler for a block.
 * @param props.nested - True for a layout group's inner container.
 * @returns The container.
 */
function StripContainer({ layout, items, onSelect, nested }: {
    layout: IZoneLayoutConfig;
    items: IStripItem[];
    onSelect: (id: string) => void;
    nested: boolean;
}) {
    const isColumn = layout.flexDirection === 'column' || layout.flexDirection === 'column-reverse';
    return (
        <div
            className={cn(styles.container, nested && styles['container--nested'], isColumn && styles['container--column'])}
            style={containerStyle(layout)}
        >
            {items.map(item => (
                item.children && item.layout ? (
                    <div
                        key={item.id}
                        className={cn(styles.group, typeof item.weight === 'number' && styles.weighted)}
                        style={itemStyle(item.weight)}
                    >
                        <button
                            type="button"
                            className={styles.group_label}
                            onClick={() => onSelect(item.id)}
                            title={`Edit ${item.label}`}
                        >
                            {item.label}
                        </button>
                        {item.children.length > 0 ? (
                            <StripContainer layout={item.layout} items={item.children} onSelect={onSelect} nested />
                        ) : (
                            <span className={styles.group_empty}>empty</span>
                        )}
                    </div>
                ) : (
                    <button
                        key={item.id}
                        type="button"
                        className={cn(styles.block, typeof item.weight === 'number' && styles.weighted)}
                        style={itemStyle(item.weight)}
                        onClick={() => onSelect(item.id)}
                        title={`Edit ${item.label}`}
                    >
                        <span className={styles.block_label}>{item.label}</span>
                        {typeof item.weight === 'number' && <span className={styles.block_weight}>{item.weight}×</span>}
                    </button>
                )
            ))}
        </div>
    );
}

/**
 * The zone strip.
 *
 * @param props - See {@link IZoneLayoutStripProps}.
 * @returns The strip, or null when there is nothing to draw.
 */
export function ZoneLayoutStrip({ layout, items, onSelect, label }: IZoneLayoutStripProps) {
    return items.length === 0 ? null : (
        <div className={styles.strip} role="group" aria-label={label}>
            <StripContainer layout={layout} items={items} onSelect={onSelect} nested={false} />
        </div>
    );
}
