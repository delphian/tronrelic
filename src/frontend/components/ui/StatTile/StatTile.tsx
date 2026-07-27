/**
 * StatTile — one labelled figure, and the grid that lays a row of them out.
 *
 * This shape (uppercase label, prominent value, one-line qualifier) had been
 * rebuilt roughly twenty times across core, the admin console and the plugins
 * before it became a primitive: three competing precedents in core alone, plus
 * a `.stat-card__*` global utility set that almost nothing consumed. Every copy
 * agreed on the design and disagreed on the class names, so the drift showed up
 * as inconsistent padding and type scale rather than as anything a reviewer
 * would catch. One component ends that, and gives themes a single handle on the
 * densest information surface the site has.
 *
 * Two sizes, one design: `md` is the page-level KPI band, `sm` the compact
 * admin readout. They differ only in tokens, so a surface can switch density
 * without switching component.
 *
 * @module components/ui/StatTile
 */

import type { CSSProperties, ReactNode } from 'react';
import { cn } from '../../../lib/cn';
import styles from './StatTile.module.scss';

/**
 * Semantic tone applied to the tile's value.
 *
 * Exported so callers mapping their own domain state onto a tile (job health,
 * error counts, coverage thresholds) can type that mapping against the
 * component rather than restating the union locally.
 */
export type StatTileTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger';

/** Density steps. Same tile, two token sets — never two designs. */
export type StatTileSize = 'sm' | 'md';

interface StatTileProps {
    /** What the figure measures. Rendered uppercase; pass it in sentence case. */
    label: ReactNode;

    /**
     * The figure itself, pre-formatted. The tile never formats numbers — unit,
     * precision and locale are domain decisions the caller owns, and a
     * primitive that guessed them would be wrong in half its uses.
     */
    value: ReactNode;

    /**
     * One-line qualifier under the value, for the context that stops a figure
     * being read as something it is not ("over 30 days", "of observed
     * delegations from one wallet"). Omit rather than pad.
     */
    note?: ReactNode;

    /**
     * Optional leading icon beside the label. Decorative by contract — the
     * label already names the figure — so it is rendered `aria-hidden`.
     */
    icon?: ReactNode;

    /**
     * Semantic colour for the value. Reserve it for figures that genuinely
     * carry a state; colouring every tile in a band spends the signal.
     * @default 'neutral'
     */
    tone?: StatTileTone;

    /**
     * Density. `md` for page-level KPI bands, `sm` for compact admin strips.
     * @default 'md'
     */
    size?: StatTileSize;

    /**
     * Whether the tile draws its own surface (background, border, corner).
     * Set `false` for a strip of figures that share one enclosing card, where
     * per-tile chrome would read as a grid of nested boxes.
     * @default true
     */
    surface?: boolean;

    className?: string;
    style?: CSSProperties;
}

/**
 * Maps tone to the modifier class carrying that tone's value colour. A lookup
 * rather than a conditional chain so a new tone is one entry and TypeScript
 * flags any tone added to the union without a colour behind it.
 */
const toneClass: Record<StatTileTone, string | undefined> = {
    neutral: undefined,
    primary: styles.tile__primary,
    success: styles.tile__success,
    warning: styles.tile__warning,
    danger: styles.tile__danger
};

/** Maps size to its density modifier. */
const sizeClass: Record<StatTileSize, string> = {
    sm: styles.tile__sm,
    md: styles.tile__md
};

/**
 * One labelled figure.
 *
 * @param props - Label, value, and the optional note/icon/tone/size/surface
 *        modifiers described on `StatTileProps`.
 * @returns The rendered tile.
 *
 * @example
 * ```tsx
 * <StatTile
 *     label="Energy delivered"
 *     value="8.27B"
 *     note="over 30 days"
 * />
 * ```
 */
export function StatTile({
    label,
    value,
    note,
    icon,
    tone = 'neutral',
    size = 'md',
    surface = true,
    className,
    style
}: StatTileProps) {
    return (
        <div
            className={cn(
                styles.tile,
                sizeClass[size],
                surface && styles.tile__surface,
                toneClass[tone],
                className
            )}
            style={style}
        >
            <span className={styles.label}>
                {icon && (
                    <span className={styles.icon} aria-hidden="true">
                        {icon}
                    </span>
                )}
                {label}
            </span>
            <span className={styles.value}>{value}</span>
            {note && <span className={styles.note}>{note}</span>}
        </div>
    );
}

interface StatGridProps {
    /** The tiles. Anything else laid out here will not align to the columns. */
    children?: ReactNode;

    /**
     * Column density of the auto-fit grid, matched to the tile size it holds.
     * Passing the size here rather than reading it off the children keeps the
     * grid a plain layout element — it never inspects or clones what it wraps.
     * @default 'md'
     */
    size?: StatTileSize;

    /**
     * Override the auto-fit column floor (e.g. `'180px'`). The size default
     * suits most bands; reach for this when a surface is unusually narrow or
     * the values are unusually wide.
     */
    minColWidth?: string;

    className?: string;
}

/**
 * Auto-fitting grid for a row of tiles.
 *
 * Ships with the tile because every site that rebuilt the tile also rebuilt
 * this grid, and a band whose columns collapse at a different width than its
 * neighbour's is the visible half of that duplication. Auto-fit against a
 * per-size floor means the same band flows from six columns on a console to
 * two in a slideout with no breakpoint rules at the call site.
 *
 * @param props - Children, density, optional column floor, class name.
 * @returns The rendered grid.
 */
export function StatGrid({ children, size = 'md', minColWidth, className }: StatGridProps) {
    const style = minColWidth
        ? ({ '--stat-tile-col-min': minColWidth } as CSSProperties)
        : undefined;

    return (
        <div
            className={cn(styles.grid, size === 'sm' ? styles.grid__sm : styles.grid__md, className)}
            style={style}
        >
            {children}
        </div>
    );
}
