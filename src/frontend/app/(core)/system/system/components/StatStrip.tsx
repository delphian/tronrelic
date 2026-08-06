'use client';

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../../../../lib/cn';
import { StatTile } from '../../../../../components/ui/StatTile';
import styles from './StatStrip.module.scss';

type Tone = 'neutral' | 'success' | 'warning' | 'danger';

interface StatItem {
    label: string;
    value: ReactNode;
    detail?: ReactNode;
    tone?: Tone;
}

interface StatStripProps {
    items: StatItem[];
    /**
     * Minimum cell width for the auto-fit grid (e.g. "100px"). Drives how
     * many columns the strip can host before wrapping inside its container.
     * Omit to inherit the shared compact-tile column floor
     * (`--stat-tile-col-min-sm`); pass a value only to run denser than that.
     */
    minColWidth?: string;
    className?: string;
}

/**
 * Compact horizontal stat readout used by the system console.
 *
 * Mission-control telemetry: a dense grid of cells, each a tiny uppercase
 * label over a monospace figure with an optional detail line — roughly half
 * the vertical footprint of the iconed tile it superseded. The grid auto-fits
 * so the strip flows from six columns on a wide console to two in a modal.
 *
 * The cells are the core `<StatTile>` at compact density, not a parallel
 * implementation: the label/value/detail typography comes from the shared
 * primitive, and this component contributes only what makes a *strip* — the
 * enclosing chrome, the mono figure, and the tone treatment, all applied by
 * scope-overriding the tile's own tokens. Tone is a 2px left rule rather than
 * the tile's coloured value, so the figures stay optically aligned down the
 * strip while the cell still reads as healthy or degraded at a glance.
 */
export function StatStrip({ items, minColWidth, className }: StatStripProps) {
    // Left unset when the caller supplies no override, so the stylesheet's
    // var() fallback supplies the shared column floor rather than this
    // component restating the value.
    const style = minColWidth ? ({ '--stat-col-min': minColWidth } as CSSProperties) : undefined;
    return (
        <div className={cn(styles.strip, className)} style={style}>
            {items.map((item, index) => (
                <StatTile
                    key={`${item.label}-${index}`}
                    size="sm"
                    // The strip draws the cell's surface itself, so the tile
                    // must not draw a second one inside it.
                    surface={false}
                    className={cn(
                        styles.cell,
                        item.tone === 'success' && styles.cell_success,
                        item.tone === 'warning' && styles.cell_warning,
                        item.tone === 'danger' && styles.cell_danger
                    )}
                    label={item.label}
                    value={item.value}
                    note={item.detail}
                />
            ))}
        </div>
    );
}
