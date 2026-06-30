'use client';

/**
 * @fileoverview CalendarHeatmap — a GitHub-contributions-style activity grid.
 *
 * Renders one cell per calendar day, coloured by an intensity bucket, so a
 * year of per-day counts reads as a single "how busy, how consistently" glance —
 * the most engaging, lowest-cost way to summarize timestamp-only activity. No
 * comparable primitive existed, so this is built as pure SVG to match the
 * LineChart/BarChart architecture in this feature (a scaled viewBox, no DOM
 * measurement) and stay reusable beyond the wallet-detail view that prompted it.
 *
 * Hydration safety: the grid's bounds are derived entirely from the supplied
 * data (its earliest and latest day), never from "now" — a server-vs-client
 * timezone disagreement about today's date would otherwise shift the grid by a
 * day and break hydration. Days are parsed and walked in UTC for the same
 * reason. Month labels use a fixed name table, not `toLocaleString`, so the
 * server and client emit byte-identical text.
 */

import type { ReactNode } from 'react';
import { cn } from '../../../../lib/cn';
import styles from './CalendarHeatmap.module.scss';

/**
 * One day's activity count — the unit the heatmap renders one cell per. Matches
 * the backend's `IActivityCalendarBucket` shape structurally, but is declared
 * locally so this chart stays a generic, domain-free primitive.
 */
export interface CalendarHeatmapDay {
    /** Calendar day as `YYYY-MM-DD` (UTC). */
    day: string;
    /** Transaction (or event) count on that day; drives the cell's intensity. */
    count: number;
}

/**
 * Props for {@link CalendarHeatmap}.
 */
interface ICalendarHeatmapProps {
    /** Per-day counts; sparse (only active days need appear). */
    data: CalendarHeatmapDay[];
    /** Optional heading rendered above the grid, left of {@link ICalendarHeatmapProps.actions}. */
    title?: string;
    /** Optional controls rendered on the right of the header row (e.g. a range toggle). */
    actions?: ReactNode;
    /** Message shown when there is nothing to plot. */
    emptyLabel?: string;
    /** Additional class names on the figure wrapper. */
    className?: string;
}

/** Cell edge length, in viewBox units. */
const CELL = 11;

/** Gap between cells, in viewBox units. */
const GAP = 3;

/** Top padding reserved for the month labels, in viewBox units. */
const TOP_PAD = 16;

/** Milliseconds per day, for UTC day arithmetic. */
const MS_PER_DAY = 86_400_000;

/**
 * Month abbreviations indexed by UTC month, used instead of `toLocaleString` so
 * month labels are identical on server and client (locale-independent).
 */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * The four "active" intensity colours, darkest→brightest. A deliberate
 * data-visualization literal palette (the documented exception to the design-
 * token rule): the green ramp encodes magnitude, not brand, so it must stay
 * fixed across themes. Level 0 (no activity) uses a token instead, so empty
 * cells still theme with the surface.
 */
const INTENSITY_COLORS = ['#0e4429', '#006d32', '#26a641', '#39d353'];

/** Parse a `YYYY-MM-DD` string to its UTC-midnight epoch ms. */
function dayToUtc(day: string): number {
    return Date.parse(`${day}T00:00:00Z`);
}

/**
 * Bucket a day's count into an intensity level 0–4 against the busiest day, so
 * the ramp always spans the wallet's own range rather than an absolute scale a
 * quiet wallet would never reach. Level 0 is reserved for zero activity.
 *
 * @param count - The day's transaction count.
 * @param max - The busiest day's count in the dataset.
 * @returns An intensity level 0 (none) through 4 (busiest quartile).
 */
function intensityLevel(count: number, max: number): number {
    if (count <= 0 || max <= 0) {
        return 0;
    }
    const ratio = count / max;
    if (ratio > 0.75) {
        return 4;
    }
    if (ratio > 0.5) {
        return 3;
    }
    if (ratio > 0.25) {
        return 2;
    }
    return 1;
}

/**
 * One positioned cell, precomputed for painting and its hover `<title>`.
 */
interface IHeatCell {
    /** Column (week) index from the grid's start. */
    column: number;
    /** Row (UTC weekday, 0=Sun). */
    row: number;
    /** `YYYY-MM-DD` of the day. */
    day: string;
    /** Transaction count on the day. */
    count: number;
    /** Intensity level 0–4. */
    level: number;
}

/**
 * CalendarHeatmap — responsive SVG activity grid.
 *
 * Builds a Sunday-aligned week grid spanning the data's date range, colours each
 * day by intensity, and scales the whole grid to its container via a uniform
 * viewBox (square cells preserved). Each cell carries a native `<title>` for an
 * accessible, dependency-free hover tooltip.
 *
 * @param props - {@link ICalendarHeatmapProps}.
 * @returns A figure containing the SVG heatmap, or an empty state.
 */
export function CalendarHeatmap({ data, title, actions, emptyLabel = 'No activity to display.', className }: ICalendarHeatmapProps) {
    const header = (title || actions) ? (
        <div className={styles.chart__header}>
            {title ? <h3 className={styles.chart__title}>{title}</h3> : null}
            {actions ? <div className={styles.chart__actions}>{actions}</div> : null}
        </div>
    ) : null;

    const counts = new Map<string, number>();
    let maxCount = 0;
    let minTime = Infinity;
    let maxTime = -Infinity;
    for (const bucket of data) {
        const time = dayToUtc(bucket.day);
        if (Number.isNaN(time)) {
            continue;
        }
        counts.set(bucket.day, bucket.count);
        if (bucket.count > maxCount) {
            maxCount = bucket.count;
        }
        if (time < minTime) {
            minTime = time;
        }
        if (time > maxTime) {
            maxTime = time;
        }
    }

    if (counts.size === 0 || !Number.isFinite(minTime)) {
        return (
            <figure className={cn(styles.chart, className)}>
                {header}
                <figcaption className={styles.empty}>{emptyLabel}</figcaption>
            </figure>
        );
    }

    // Align the grid's first column to the Sunday on or before the earliest day,
    // so every column is a full Sun–Sat week and weekday rows line up.
    const startWeekday = new Date(minTime).getUTCDay();
    const gridStart = minTime - startWeekday * MS_PER_DAY;
    const totalDays = Math.round((maxTime - gridStart) / MS_PER_DAY) + 1;
    const columns = Math.ceil(totalDays / 7);

    const cells: IHeatCell[] = [];
    const monthLabels: Array<{ column: number; label: string }> = [];
    let lastLabelledMonth = -1;
    for (let offset = 0; offset < totalDays; offset++) {
        const time = gridStart + offset * MS_PER_DAY;
        const date = new Date(time);
        const day = date.toISOString().slice(0, 10);
        const column = Math.floor(offset / 7);
        const row = date.getUTCDay();
        const count = counts.get(day) ?? 0;

        cells.push({ column, row, day, count, level: intensityLevel(count, maxCount) });

        // Label a month at the first column its first-of-month (or grid start)
        // falls in, so the axis reads left-to-right like a calendar.
        const month = date.getUTCMonth();
        if (month !== lastLabelledMonth && date.getUTCDate() <= 7) {
            monthLabels.push({ column, label: MONTH_NAMES[month] });
            lastLabelledMonth = month;
        }
    }

    const width = columns * (CELL + GAP);
    const height = TOP_PAD + 7 * (CELL + GAP);

    return (
        <figure className={cn(styles.chart, className)}>
            {header}
            <svg
                className={styles.heatmap}
                viewBox={`0 0 ${width} ${height}`}
                preserveAspectRatio="xMinYMid meet"
                role="img"
                aria-label={`Activity heatmap across ${counts.size} active days`}
            >
                {monthLabels.map((entry) => (
                    <text
                        key={`month-${entry.column}-${entry.label}`}
                        className={styles.month_label}
                        x={entry.column * (CELL + GAP)}
                        y={TOP_PAD - 6}
                    >
                        {entry.label}
                    </text>
                ))}
                {cells.map((cell) => (
                    <rect
                        key={cell.day}
                        className={styles.cell}
                        x={cell.column * (CELL + GAP)}
                        y={TOP_PAD + cell.row * (CELL + GAP)}
                        width={CELL}
                        height={CELL}
                        rx={2}
                        style={{ fill: cell.level === 0 ? 'var(--color-border-strong)' : INTENSITY_COLORS[cell.level - 1] }}
                    >
                        <title>{`${cell.count.toLocaleString()} transaction${cell.count === 1 ? '' : 's'} on ${cell.day}`}</title>
                    </rect>
                ))}
            </svg>
            <figcaption className={styles.legend}>
                <span>Less</span>
                <span className={styles.legend__cells}>
                    <span className={styles.legend__cell} style={{ background: 'var(--color-border-strong)' }} />
                    {INTENSITY_COLORS.map((color) => (
                        <span key={color} className={styles.legend__cell} style={{ background: color }} />
                    ))}
                </span>
                <span>More</span>
            </figcaption>
        </figure>
    );
}
