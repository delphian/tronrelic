'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../../lib/cn';
import styles from './BarChart.module.css';

/**
 * Individual data point for a bar chart series.
 */
interface BarDataPoint {
    /** ISO date string or timestamp identifying the category bucket */
    date: string;
    /** Numeric value to plot (may be negative — bars render below the baseline) */
    value: number;
    /** Optional metadata surfaced in the hover tooltip (normal mode only) */
    metadata?: Record<string, any>;
}

/**
 * Bar chart series configuration for grouped (side-by-side) column charts.
 */
export interface BarChartSeries {
    /** Unique identifier for the series */
    id: string;
    /** Display label for legend and tooltip */
    label: string;
    /** Array of data points; one column per shared category, grouped across series */
    data: BarDataPoint[];
    /**
     * Column color. Accepts any CSS color string, including a token reference
     * (`var(--chart-color-2)`). Defaults to the `--chart-color-*` palette by index.
     */
    color?: string;
    /**
     * Optional aggregate annotation rendered after the label in the legend only
     * (never the tooltip or bar title), letting the legend serve as a complete
     * key — e.g. a per-series window total.
     */
    legendValue?: ReactNode;
}

/**
 * Rendering density for the chart.
 *
 * - `normal` — full chrome: axes, gridlines, legend, and an interactive tooltip.
 * - `widget` — very compact: bars and baseline only, no axes/legend/tooltip,
 *   sized to drop into a small widget zone.
 */
type BarChartMode = 'normal' | 'widget';

/**
 * Properties for the BarChart component.
 */
interface BarChartProps {
    /** Array of data series to plot as grouped columns */
    series: BarChartSeries[];
    /**
     * Optional heading rendered above the chart. Lets a caller (e.g. a widget
     * surfacing an operator-set graph title) label the chart without wrapping it
     * in its own header. Omitted renders no title element.
     */
    title?: string;
    /**
     * Optional controls rendered on the right of the chart's header row, sharing
     * that row with the title. Lets a caller (e.g. a widget with resource/window
     * toggles) place its controls on the same line as the title instead of
     * stacking its own toolbar above the chart, which left the title beneath the
     * toggles. Omitted renders no header actions.
     */
    actions?: ReactNode;
    /** Rendering density (default: 'normal') */
    mode?: BarChartMode;
    /** Chart height in pixels (default: 320 in normal mode, 120 in widget mode) */
    height?: number;
    /** Custom formatter for Y-axis labels and tooltip values */
    yAxisFormatter?: (value: number) => string;
    /** Custom formatter for X-axis tick labels (kept compact — date only by default) */
    xAxisFormatter?: (value: Date) => string;
    /**
     * Custom formatter for the tooltip's date heading. Defaults to date plus
     * hour and minute, so the hovered bucket's time is visible even when the
     * compact x-axis only shows the day. Tooltip-only (hover, post-hydration),
     * so locale-dependent time output is hydration-safe here.
     */
    tooltipDateFormatter?: (value: Date) => string;
    /**
     * Optional renderer for a hovered bar's `metadata`, appended below the
     * series rows in the tooltip. Injected (not hardcoded) so the chart stays
     * generic: a caller that attaches domain metadata to its data points —
     * e.g. the analytics overview attaching each bucket's top paths — owns how
     * that metadata reads, while charts that attach none render an unchanged
     * tooltip. Called once per hovered series-point that carries metadata.
     */
    tooltipMetadataFormatter?: (metadata: Record<string, any>) => ReactNode;
    /** Additional CSS class names */
    className?: string;
    /** Message to show when no data is available */
    emptyLabel?: string;
    /** Fixed minimum value for Y-axis (overrides auto-calculated minimum) */
    yAxisMin?: number;
    /** Fixed maximum value for Y-axis (overrides auto-calculated maximum) */
    yAxisMax?: number;
    /**
     * Render the Y-axis on a whole-number scale: bounds snap to integer step
     * multiples and each tick is a distinct integer. Set this for count data
     * (visitors, pageviews) instead of rounding fractional ticks in the caller's
     * `yAxisFormatter` — that rounding is what collapses a small domain's ticks
     * into duplicate labels (0, 0.67, 1.33, 2 → "0, 1, 1, 2"). Off by default so
     * continuous-value charts keep their evenly-spaced fractional ticks.
     */
    integerTicks?: boolean;
    /**
     * Render the legend. Defaults to the mode's behavior (`normal` shows it,
     * `widget` hides it); set explicitly to override — e.g. `true` to surface a
     * key in a compact widget that no longer renders its own summary line.
     */
    showLegend?: boolean;
    /**
     * Column layout across series within a category (default: `'grouped'`).
     *
     * - `grouped` — one column per series, side by side within the category slot.
     * - `stacked` — a single column per category; series stack from the zero
     *   baseline, positive values accumulating upward and negative values
     *   downward. This is what turns a signed in/out pair into one diverging
     *   column (green up, red down) instead of two side-by-side bars.
     */
    layout?: 'grouped' | 'stacked';
}

/**
 * Per-mode chrome configuration. Density-driven layout lives here so the render
 * body stays declarative and the two modes cannot drift apart accidentally.
 */
const CHROME: Record<BarChartMode, {
    margin: { top: number; right: number; bottom: number; left: number };
    defaultHeight: number;
    minWidth: number;
    showAxes: boolean;
    showLegend: boolean;
    interactive: boolean;
    /** Fraction of each category slot occupied by its bar group (rest is gutter) */
    groupInnerRatio: number;
    /** Corner radius applied to the top of each column */
    barRadius: number;
    /** Floor on rendered bar width so dense datasets stay visible */
    minBarWidth: number;
}> = {
    normal: {
        margin: { top: 16, right: 20, bottom: 32, left: 56 },
        defaultHeight: 320,
        minWidth: 320,
        showAxes: true,
        showLegend: true,
        interactive: true,
        groupInnerRatio: 0.7,
        barRadius: 2,
        minBarWidth: 1
    },
    widget: {
        margin: { top: 3, right: 3, bottom: 3, left: 3 },
        defaultHeight: 120,
        minWidth: 80,
        showAxes: false,
        showLegend: false,
        interactive: false,
        groupInnerRatio: 0.9,
        barRadius: 0,
        minBarWidth: 0.5
    }
};

/**
 * A single rendered column, precomputed for both painting and hit-testing.
 */
interface RenderBar {
    seriesId: string;
    label: string;
    color: string;
    categoryTime: number;
    x: number;
    y: number;
    width: number;
    height: number;
    value: number;
    metadata?: Record<string, any>;
}

/**
 * One tooltip row (one series' value at the hovered category).
 */
interface TooltipDatum {
    /** Series id — the stable, unique key for the row (labels may repeat) */
    id: string;
    label: string;
    value: number;
    color: string;
    metadata?: Record<string, any>;
}

/**
 * Complete tooltip state for the hovered category.
 */
interface TooltipState {
    x: number;
    y: number;
    date: Date;
    items: TooltipDatum[];
    /**
     * Displayed (CSS pixel) width of the chart at hover time. Captured from the
     * SVG's bounding box so the tooltip can be clamped into the chart's on-screen
     * bounds regardless of how the viewBox is scaled to its container.
     */
    chartWidthPx: number;
}

/**
 * Gutter, in CSS pixels, kept between the tooltip box and either edge of the
 * chart when its center is clamped. A small layout constant in the spirit of the
 * other geometry literals in CHROME — not a themable value.
 */
const TOOLTIP_EDGE_GUTTER = 8;

/**
 * Width, in viewBox units, assumed before the ResizeObserver measures the real
 * container. The server cannot measure layout, so SSR and the first client render
 * use this fixed value — keeping the two byte-identical (no hydration mismatch).
 * Paired with a fixed pixel height and `preserveAspectRatio="xMinYMid meet"` on
 * the SVG, the later measured correction only widens the viewBox horizontally; it
 * never resizes the chart's box, which is what previously produced the visible
 * post-hydration "load". `meet` scales the content uniformly and left-anchors it,
 * so before measurement the chart renders undistorted at its natural width with
 * transient empty space on the right rather than stretching text and bars to fill.
 * 640 sits near the geometric mean of a narrow widget column and a full-width page,
 * bounding that transient gap in either context.
 */
const SSR_DEFAULT_WIDTH = 640;

/**
 * Converts a date string to a Date object, handling ISO 8601 timestamps.
 *
 * Mirrors LineChart's parser so both charts interpret backend UTC timestamps
 * identically; the resulting Date is displayed in the user's locale by the
 * xAxisFormatter.
 *
 * @param value - ISO date string or timestamp
 * @returns Parsed Date object
 */
function toDate(value: string) {
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
        return new Date(value);
    }
    return new Date(time);
}

/**
 * Default formatter for the tooltip's date heading: short date plus 24-hour
 * time. Gives the hovered bucket an hour/minute even when the x-axis label is
 * date-only, without the caller having to wire a formatter through.
 *
 * @param value - The hovered category's Date
 * @returns A localized "date HH:MM" string
 */
function defaultTooltipDateFormatter(value: Date) {
    const date = value.toLocaleDateString();
    const time = value.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false });
    return `${date} ${time}`;
}

/**
 * Resolves a series' column color, falling back to the themed chart palette.
 *
 * The fallback references `--chart-color-*` (a token, not a hardcoded hex) so
 * series colors stay theme-aware while remaining a deliberate data-viz literal
 * when the caller supplies one.
 *
 * @param color - Caller-supplied color, if any
 * @param index - Series index used to cycle the palette
 * @returns A CSS color string suitable for an SVG fill
 */
function resolveColor(color: string | undefined, index: number) {
    return color ?? `var(--chart-color-${(index % 10) + 1})`;
}

/**
 * Picks a "nice" whole-number step for an integer axis so gridlines land on
 * round values a reader expects (…1, 2, 5, 10, 20, 50…) rather than arbitrary
 * fractions. This is the piece that prevents duplicate axis labels: the default
 * four-tick split of a small domain produces fractional values (0, 0.67, 1.33,
 * 2) that an integer formatter collapses to repeats ("0, 1, 1, 2"). Snapping to
 * a whole-number step guarantees every tick is a distinct integer.
 *
 * @param span - Height of the value domain (maxY − minY); assumed ≥ 1 so a
 *   flat/degenerate domain still yields a usable step.
 * @param targetTicks - Rough number of intervals wanted, tuning step coarseness.
 * @returns A step that is a whole number ≥ 1 (1/2/5 × a power of ten).
 */
function niceIntegerStep(span: number, targetTicks = 3) {
    const rough = span / targetTicks;
    if (rough <= 1) {
        return 1;
    }
    const magnitude = Math.pow(10, Math.floor(Math.log10(rough)));
    const normalized = rough / magnitude;
    const niceNormalized = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
    return niceNormalized * magnitude;
}

/**
 * Snaps an auto-computed domain to whole-number bounds and emits one tick per
 * step, so a count-based chart renders an integer axis with distinct labels.
 * Auto bounds expand outward to the nearest step multiple (giving headroom and a
 * top gridline that lines up with the data); a caller-pinned bound is respected
 * as-is so an explicit `yAxisMin`/`yAxisMax` still wins. Because every tick is a
 * multiple of an integer step, a zero baseline is always included when the domain
 * straddles it — no separate zero-tick insertion is needed.
 *
 * @param minY - Lower domain bound after baseline/pinning resolution.
 * @param maxY - Upper domain bound after baseline/pinning resolution.
 * @param fixedMin - The caller's `yAxisMin`, if pinned — left untouched when set.
 * @param fixedMax - The caller's `yAxisMax`, if pinned — left untouched when set.
 * @returns The (possibly widened) integer domain plus ascending tick values.
 */
function niceIntegerAxis(minY: number, maxY: number, fixedMin?: number, fixedMax?: number) {
    const step = niceIntegerStep(Math.max(maxY - minY, 1));
    const axisMin = fixedMin !== undefined ? minY : Math.floor(minY / step) * step;
    let axisMax = fixedMax !== undefined ? maxY : Math.ceil(maxY / step) * step;
    if (axisMin >= axisMax) {
        axisMax = axisMin + step;
    }
    const ticks: number[] = [];
    // Guard the loop bound with a half-step epsilon so float drift cannot drop
    // the final tick, and cap the iteration count so a pathological pinned domain
    // (huge span, tiny step) can never spin unbounded.
    for (let value = axisMin; value <= axisMax + step / 2 && ticks.length < 1000; value += step) {
        ticks.push(value);
    }
    return { min: axisMin, max: axisMax, ticks };
}

/**
 * BarChart - Responsive SVG grouped column chart with normal and widget modes.
 *
 * Renders one column per series for each shared category (typically a time
 * bucket). The `layout` prop selects `grouped` (series side by side) or `stacked`
 * (a single column per category, series accumulating from the baseline). Supports
 * negative values (columns drop below a zero baseline — and in `stacked` layout a
 * signed pair becomes one diverging column), fixed or auto Y-axis bounds, and a
 * ResizeObserver-driven width so it adapts to any container — full page, card, or
 * compact widget zone.
 *
 * Structural chrome (axes, gridlines, baseline, labels) is styled through the
 * colocated CSS Module using design tokens; only data-driven column fills are
 * applied inline, per the data-visualization exception to the token rules.
 *
 * The `mode` prop selects density: `normal` paints full chrome plus an
 * interactive tooltip, while `widget` strips everything to bars and baseline for
 * a sparkline-like footprint.
 *
 * @param props - Component properties with series data and configuration
 * @returns A figure element containing the SVG chart (and legend in normal mode)
 */
export function BarChart({
    series,
    title,
    actions,
    mode = 'normal',
    height: propHeight,
    yAxisFormatter = value => value.toLocaleString(),
    xAxisFormatter = value => value.toLocaleDateString(),
    tooltipDateFormatter = defaultTooltipDateFormatter,
    tooltipMetadataFormatter,
    className,
    emptyLabel = 'Not enough data to render a chart.',
    yAxisMin: fixedYMin,
    yAxisMax: fixedYMax,
    integerTicks = false,
    showLegend,
    layout = 'grouped'
}: BarChartProps) {
    const chrome = CHROME[mode];
    const height = propHeight ?? chrome.defaultHeight;
    const isWidget = mode === 'widget';
    // Tri-state: an explicit prop overrides the mode default, so a compact
    // widget can opt into the legend as its key. Left undefined, the mode rules.
    const resolvedShowLegend = showLegend ?? chrome.showLegend;

    const [container, setContainer] = useState<HTMLElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(Math.max(SSR_DEFAULT_WIDTH, chrome.minWidth));
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [tooltipNode, setTooltipNode] = useState<HTMLDivElement | null>(null);
    const [tooltipWidth, setTooltipWidth] = useState(0);
    const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());
    const [pinned, setPinned] = useState(false);
    // Synchronous mirror of `pinned` for the pointer-move/leave guards. A touch
    // tap dispatches pointerdown → pointerup → pointerleave within one gesture,
    // before React re-renders with the new `pinned` value, so a handler reading
    // the captured `pinned` state would see it stale and clear the just-pinned
    // tooltip. The ref updates in the same tick as the pin, so the guards see the
    // truth immediately; `pinned` state still exists to drive the dismissal effect.
    const pinnedRef = useRef(false);

    /**
     * Measures the rendered tooltip's width so its center can be clamped to keep
     * the whole box inside the chart. The tooltip mounts only on hover (never
     * during SSR), so reading its box in an effect is hydration-safe; the width
     * is stable across hovers, so a single measurement per mount suffices.
     */
    useEffect(() => {
        if (tooltipNode) {
            setTooltipWidth(tooltipNode.getBoundingClientRect().width);
        }
    }, [tooltipNode]);

    /**
     * Observes container width changes and updates the chart responsively.
     * Backed by a state ref (`container`) rather than `useRef` so the observer
     * attaches whenever the figure mounts — including the empty-state-to-loaded
     * transition, where the figure is absent on the first render. Disconnects on
     * unmount to avoid leaks. Skipped entirely in non-DOM/SSR.
     */
    useEffect(() => {
        if (!container || typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                setContainerWidth(Math.max(chrome.minWidth, Math.round(entry.contentRect.width)));
            }
        });

        observer.observe(container);
        return () => observer.disconnect();
    }, [container, chrome.minWidth]);

    /**
     * While a tooltip is pinned, dismiss it on any pointer-down outside the chart
     * figure or on Escape — the "click anywhere else" half of the pin contract.
     * The containment check spares interactions inside the figure: the pinning
     * tap itself, a click on a different bar (which re-pins), the tooltip, and the
     * legend. Only a genuine outside interaction clears the pin. The listener is
     * bound to `document` solely while pinned, so there is no idle global handler,
     * and it lives in an effect (client-only) so SSR is untouched.
     */
    useEffect(() => {
        if (!pinned) {
            return;
        }
        const dismiss = (event: PointerEvent) => {
            const target = event.target;
            if (container && target instanceof Node && container.contains(target)) {
                return;
            }
            pinnedRef.current = false;
            setPinned(false);
            setTooltip(null);
        };
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                pinnedRef.current = false;
                setPinned(false);
                setTooltip(null);
            }
        };
        document.addEventListener('pointerdown', dismiss);
        document.addEventListener('keydown', handleKey);
        return () => {
            document.removeEventListener('pointerdown', dismiss);
            document.removeEventListener('keydown', handleKey);
        };
    }, [pinned, container]);

    /**
     * Toggles visibility of a series by ID (normal-mode legend interaction).
     * Hiding a series rescales the Y-axis to the remaining data. Refuses to hide
     * the last visible series so the chart never collapses to the empty state —
     * which would remove the legend and leave no control to restore the data.
     */
    const toggleSeries = (seriesId: string) => {
        setHiddenSeries(prev => {
            const next = new Set(prev);
            if (next.has(seriesId)) {
                next.delete(seriesId);
            } else {
                const visibleCount = series.filter(
                    item => item.data.length > 0 && !next.has(item.id)
                ).length;
                if (visibleCount <= 1) {
                    return prev;
                }
                next.add(seriesId);
            }
            return next;
        });
    };

    /**
     * Stable fallback colors keyed by series id, derived from each series' index
     * in the original `series` array. Because the index never depends on which
     * series are hidden or empty, a series renders the same color in its bars,
     * tooltip, and legend dot — the three would otherwise desync once an earlier
     * series is hidden and the filtered indices shift.
     */
    const seriesColors = useMemo(
        () => new Map(series.map((item, index) => [item.id, resolveColor(item.color, index)])),
        [series]
    );

    /**
     * Computes scales, category layout, and the full list of rendered columns.
     *
     * Memoized to avoid recomputing grouped-bar geometry on every hover. Returns
     * null when there is no visible data, triggering the empty state.
     */
    const chartData = useMemo(() => {
        const visibleSeries = series.filter(item => item.data.length > 0 && !hiddenSeries.has(item.id));
        if (!visibleSeries.length) {
            return null;
        }

        const isStacked = layout === 'stacked';

        // Domain drivers differ by layout. Grouped bars are measured individually,
        // so the extremes are the min/max of any single value. Stacked bars pile
        // per category — positive values accumulate up, negative down — so the
        // extremes are the tallest positive stack and deepest negative stack across
        // categories; using individual values would clip a column that overflows
        // its own axis.
        let domainMin: number;
        let domainMax: number;
        if (isStacked) {
            const posByTime = new Map<number, number>();
            const negByTime = new Map<number, number>();
            visibleSeries.forEach(item => item.data.forEach(point => {
                const time = toDate(point.date).getTime();
                if (Number.isNaN(time)) {
                    return;
                }
                if (point.value >= 0) {
                    posByTime.set(time, (posByTime.get(time) ?? 0) + point.value);
                } else {
                    negByTime.set(time, (negByTime.get(time) ?? 0) + point.value);
                }
            }));
            domainMax = Math.max(0, ...posByTime.values());
            domainMin = Math.min(0, ...negByTime.values());
        } else {
            const allValues = visibleSeries.flatMap(item => item.data.map(point => point.value));
            domainMin = Math.min(...allValues);
            domainMax = Math.max(...allValues);
        }

        // Bars are measured against a zero baseline, so the default domain always
        // includes 0; callers can still pin either bound explicitly.
        let minY: number;
        let maxY: number;

        if (fixedYMin !== undefined) {
            minY = fixedYMin;
        } else {
            minY = Math.min(0, domainMin);
        }

        if (fixedYMax !== undefined) {
            maxY = fixedYMax;
        } else {
            maxY = Math.max(0, domainMax);
        }

        // Guard against a non-ascending domain. Two ways it arises: a zero-height
        // domain (all values equal / all zero), or a one-sided pinned bound that
        // inverts the axis — a yAxisMin pinned above the data (auto maxY lands below
        // it) or a yAxisMax pinned below it (auto minY lands above it). A negative
        // rangeY would flip every tick and bar, so restore ascending order by
        // expanding whichever edge is auto, honoring the pinned bound where possible.
        if (minY >= maxY) {
            if (fixedYMax === undefined) {
                maxY = minY + 1;
            } else if (fixedYMin === undefined) {
                minY = maxY - 1;
            } else {
                maxY = minY + 1;
            }
        }

        // Integer-axis callers (count data) snap the domain to whole-number
        // bounds here so both the scale and the ticks are integer-valued. Done
        // before rangeY/scaleY so bar heights map against the snapped domain, and
        // the resulting tick values are reused verbatim below instead of the
        // fractional four-tick split.
        let integerTickValues: number[] | null = null;
        if (integerTicks) {
            const axis = niceIntegerAxis(minY, maxY, fixedYMin, fixedYMax);
            minY = axis.min;
            maxY = axis.max;
            integerTickValues = axis.ticks;
        }

        const rangeY = maxY - minY || 1;

        const width = Math.max(containerWidth, chrome.minWidth);
        const innerWidth = width - chrome.margin.left - chrome.margin.right;
        const innerHeight = height - chrome.margin.top - chrome.margin.bottom;

        const scaleY = (value: number) =>
            chrome.margin.top + innerHeight - ((value - minY) / rangeY) * innerHeight;

        // A viewer-pinned domain (yAxisMin/yAxisMax) can sit inside the data's true
        // range, so a value may map above the plot top or below its bottom. Clamp every
        // derived y to the plot rectangle so an out-of-range bar stops flush at the axis
        // edge instead of overflowing into the header, gridlines, or tick labels. In
        // auto-fit mode the domain already covers the data, so this is a no-op there.
        const plotTop = chrome.margin.top;
        const plotBottom = chrome.margin.top + innerHeight;
        const clampY = (value: number) => Math.min(Math.max(value, plotTop), plotBottom);

        // The baseline sits at zero when zero is in range, otherwise at the floor.
        const zeroInRange = minY <= 0 && maxY >= 0;
        const baselineY = scaleY(zeroInRange ? 0 : minY);

        // Categories are the sorted union of all timestamps across visible series.
        // Drop unparseable dates (NaN) so they cannot poison coordinate math, and
        // bail to the empty state if nothing valid remains (avoids divide-by-zero).
        const categoryTimes = Array.from(
            new Set(visibleSeries.flatMap(item => item.data.map(point => toDate(point.date).getTime())))
        )
            .filter(time => !Number.isNaN(time))
            .sort((a, b) => a - b);

        if (categoryTimes.length === 0) {
            return null;
        }

        const groupWidth = innerWidth / categoryTimes.length;
        const groupInner = groupWidth * chrome.groupInnerRatio;
        const groupPad = (groupWidth - groupInner) / 2;
        const seriesCount = visibleSeries.length;
        const slotWidth = groupInner / seriesCount;
        // Small inset between adjacent bars in a group; none when a group is one bar.
        const barInset = seriesCount > 1 ? Math.min(slotWidth * 0.12, 2) : 0;
        const barWidth = Math.max(slotWidth - barInset, chrome.minBarWidth);

        // Fast lookup of each series' value/metadata by category time. Color is
        // resolved from the stable per-id map, not the filtered position, so it
        // stays aligned with the legend when series are hidden.
        const seriesLookup = visibleSeries.map(item => {
            const byTime = new Map<number, BarDataPoint>();
            item.data.forEach(point => byTime.set(toDate(point.date).getTime(), point));
            return { item, color: seriesColors.get(item.id) ?? resolveColor(item.color, 0), byTime };
        });

        const categories = categoryTimes.map((time, categoryIndex) => {
            const groupStart = chrome.margin.left + categoryIndex * groupWidth + groupPad;
            return { time, date: new Date(time), centerX: groupStart + groupInner / 2 };
        });

        // Stacked columns fill the whole category slot (one column, not N slots).
        const stackedWidth = Math.max(groupInner, chrome.minBarWidth);

        const bars: RenderBar[] = [];
        categoryTimes.forEach((time, categoryIndex) => {
            const groupStart = chrome.margin.left + categoryIndex * groupWidth + groupPad;
            if (isStacked) {
                // Accumulate in value space: positives climb from zero upward, negatives
                // drop from zero downward, so each segment sits atop the previous same-sign
                // run. A signed in/out pair therefore becomes one column split at the
                // baseline (green above, red below).
                let posCum = 0;
                let negCum = 0;
                seriesLookup.forEach(({ item, color, byTime }) => {
                    const point = byTime.get(time);
                    if (!point) {
                        return;
                    }
                    let segmentStart: number;
                    let segmentEnd: number;
                    if (point.value >= 0) {
                        segmentStart = posCum;
                        segmentEnd = posCum + point.value;
                        posCum = segmentEnd;
                    } else {
                        segmentStart = negCum;
                        segmentEnd = negCum + point.value;
                        negCum = segmentEnd;
                    }
                    const topY = clampY(scaleY(Math.max(segmentStart, segmentEnd)));
                    const bottomY = clampY(scaleY(Math.min(segmentStart, segmentEnd)));
                    const barHeight = Math.max(bottomY - topY, chrome.minBarWidth);
                    bars.push({
                        seriesId: item.id,
                        label: item.label,
                        color,
                        categoryTime: time,
                        x: groupStart,
                        y: topY,
                        width: stackedWidth,
                        height: barHeight,
                        value: point.value,
                        metadata: point.metadata
                    });
                });
                return;
            }
            seriesLookup.forEach(({ item, color, byTime }, seriesIndex) => {
                const point = byTime.get(time);
                if (!point) {
                    return;
                }
                const valueY = clampY(scaleY(point.value));
                const top = Math.min(valueY, baselineY);
                const barHeight = Math.max(Math.abs(valueY - baselineY), chrome.minBarWidth);
                bars.push({
                    seriesId: item.id,
                    label: item.label,
                    color,
                    categoryTime: time,
                    x: groupStart + seriesIndex * slotWidth + barInset / 2,
                    y: top,
                    width: barWidth,
                    height: barHeight,
                    value: point.value,
                    metadata: point.metadata
                });
            });
        });

        // Y-axis ticks (normal mode). Integer mode uses the whole-number tick
        // values computed above (already distinct and zero-inclusive); otherwise
        // fall back to four evenly spaced ticks, plus an explicit zero tick when
        // the data crosses the baseline.
        const yTicks = integerTickValues
            ? integerTickValues.map(value => ({ value, y: scaleY(value) }))
            : Array.from({ length: 4 }).map((_, index) => {
                const value = minY + (rangeY / 3) * index;
                return { value, y: scaleY(value) };
            });
        if (!integerTickValues && zeroInRange && minY < 0 && maxY > 0) {
            const hasZeroTick = yTicks.some(tick => Math.abs(tick.value) < 0.0001);
            if (!hasZeroTick) {
                yTicks.push({ value: 0, y: scaleY(0) });
                yTicks.sort((a, b) => b.value - a.value);
            }
        }

        // X-axis ticks (normal mode): first, middle, last category.
        const xTicks = categories.length
            ? [categories[0], categories[Math.floor((categories.length - 1) / 2)], categories[categories.length - 1]]
            : [];

        return {
            width,
            height,
            bars,
            categories,
            yTicks,
            xTicks,
            baselineY,
            zeroInRange,
            seriesLookup
        };
    }, [series, hiddenSeries, containerWidth, height, chrome, fixedYMin, fixedYMax, integerTicks, seriesColors, layout]);

    // Optional header row shared by the empty and populated renders: the
    // operator-set title on the left, caller-supplied controls (e.g. a widget's
    // resource/window toggles) on the right. Kept a direct child of the figure —
    // outside the `.plot` positioning context — so a rendered header never
    // offsets the tooltip's SVG-relative top. Renders nothing when neither is
    // supplied so an untitled, control-less chart is unchanged.
    const header = (title || actions) ? (
        <div className={styles.chart__header}>
            {title ? <h3 className={styles.chart__title}>{title}</h3> : null}
            {actions ? <div className={styles.chart__actions}>{actions}</div> : null}
        </div>
    ) : null;

    if (!chartData) {
        return (
            <div className={cn(styles.chart, className)}>
                {header}
                {/*
                  * Reserve the chart's pixel height while empty so an async
                  * empty→populated transition does not shift surrounding layout (CLS).
                  * The height is a data-driven dimension (the data-viz exception), so it
                  * rides inline; the label's flex-centering lives in the module. Mirrors
                  * the populated layout — title above, chart-area box below.
                  */}
                <div className={styles.chart__empty} style={{ minHeight: height }}>
                    {emptyLabel}
                </div>
            </div>
        );
    }

    const { width, height: chartHeight, bars, categories, yTicks, xTicks, baselineY, seriesLookup } = chartData;

    /**
     * Resolves the category nearest the pointer X and builds the tooltip rows for
     * every visible series there. Shared by hover (`handlePointerMove`) and
     * click/tap-to-pin (`handlePointerDown`) so both select a bucket identically.
     * Normal mode only; returns null when the chart is non-interactive, has no
     * categories, or the nearest bucket carries no visible series point.
     *
     * @param event - React pointer event from the SVG element (mouse, touch, or pen)
     * @returns The tooltip state to display, or null to show nothing
     */
    const resolveTooltipAt = (event: React.PointerEvent<SVGSVGElement>): TooltipState | null => {
        if (!chrome.interactive || !categories.length) {
            return null;
        }

        const bounds = event.currentTarget.getBoundingClientRect();
        // The SVG is scaled to its container; map client px back to viewBox px.
        const scale = bounds.width / width;
        const pointerX = (event.clientX - bounds.left) / (scale || 1);

        let nearest = categories[0];
        let minDistance = Math.abs(categories[0].centerX - pointerX);
        for (let index = 1; index < categories.length; index += 1) {
            const candidate = categories[index];
            const distance = Math.abs(candidate.centerX - pointerX);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = candidate;
            }
        }

        const items: TooltipDatum[] = seriesLookup
            .map(({ item, color, byTime }) => {
                const point = byTime.get(nearest.time);
                if (!point) {
                    return null;
                }
                const datum: TooltipDatum = {
                    id: item.id,
                    label: item.label,
                    value: point.value,
                    color,
                    metadata: point.metadata
                };
                return datum;
            })
            .filter((item): item is TooltipDatum => Boolean(item));

        if (!items.length) {
            return null;
        }

        return { x: nearest.centerX, y: chrome.margin.top, date: nearest.date, items, chartWidthPx: bounds.width };
    };

    /**
     * Updates the hovered tooltip as the pointer moves. No-ops while a tooltip is
     * pinned (read from `pinnedRef` synchronously so a touch tap's trailing
     * pointermove cannot fight the pin), so a pinned bucket stays put.
     *
     * @param event - React pointer event from the SVG element
     */
    const handlePointerMove = (event: React.PointerEvent<SVGSVGElement>) => {
        if (pinnedRef.current) {
            return;
        }
        setTooltip(resolveTooltipAt(event));
    };

    /**
     * Clears the tooltip when the pointer leaves the chart — unless it is pinned,
     * in which case the pin owns the tooltip until an outside click or Escape.
     */
    const handlePointerLeave = () => {
        if (pinnedRef.current) {
            return;
        }
        setTooltip(null);
    };

    /**
     * Pins the tooltip to the clicked/tapped bucket so it survives pointer-out —
     * the primary way to read a bar on touch, where hover is unreliable. Updates
     * `pinnedRef` synchronously (guarding the same gesture's trailing move/leave)
     * and `pinned` state to arm the outside-click/Escape dismissal effect. A tap
     * on a bucket with no data unpins, matching a click on empty chart area.
     *
     * @param event - React pointer event from the SVG element (mouse or touch)
     */
    const handlePointerDown = (event: React.PointerEvent<SVGSVGElement>) => {
        const next = resolveTooltipAt(event);
        pinnedRef.current = Boolean(next);
        setPinned(Boolean(next));
        setTooltip(next);
    };

    const ariaLabel = `Bar chart: ${series.map(item => item.label).join(', ')}`;

    // Clamp the tooltip's center so the whole box stays within the chart's
    // on-screen bounds — at the edges it would otherwise overflow by half its
    // width (~160px), spilling past the chart and, on a wide chart, the screen.
    // When the chart is too narrow to fit the box plus both gutters, fall back to
    // centering (the box itself caps at the chart width via `max-width: 100%`).
    let tooltipLeftPx = 0;
    let tooltipTopPx = 0;
    if (tooltip) {
        // The SVG scales uniformly to its container, so both axes share the
        // factor chartWidthPx / width. tooltip.x and tooltip.y are viewBox units;
        // multiply both by chartWidthPx / width to land in on-screen CSS pixels.
        const centerPx = (tooltip.x / width) * tooltip.chartWidthPx;
        tooltipTopPx = (tooltip.y / width) * tooltip.chartWidthPx;
        const halfWidth = tooltipWidth / 2;
        const minLeft = TOOLTIP_EDGE_GUTTER + halfWidth;
        const maxLeft = tooltip.chartWidthPx - TOOLTIP_EDGE_GUTTER - halfWidth;
        tooltipLeftPx = minLeft <= maxLeft
            ? Math.min(Math.max(centerPx, minLeft), maxLeft)
            : tooltip.chartWidthPx / 2;
    }

    return (
        <figure ref={setContainer} className={cn(styles.chart, isWidget && styles['chart--widget'], className)}>
            {header}
            {/*
              * Positioning context for the absolutely-positioned tooltip. The tooltip
              * uses `top: tooltipTopPx`, an SVG-derived Y coordinate that is only valid
              * measured from the SVG's top edge. The optional header is kept a direct
              * child of the figure (outside this wrapper), so the wrapper begins exactly
              * where the SVG does — a rendered title cannot push the SVG down and shift
              * every tooltip upward by the heading's height. The legend stays outside the
              * wrapper too so it is not captured by the positioning context.
              */}
            <div className={styles.plot}>
                {/*
                  * Render at a fixed pixel height with a uniformly-scaled viewBox so the
                  * chart occupies its final box during SSR. Height no longer derives from
                  * the pre-measurement viewBox aspect ratio (CSS `height: auto`), which
                  * made the server paint the chart at the wrong height and grow it after
                  * the ResizeObserver fired — the visible "loading" jump. With
                  * `preserveAspectRatio="xMinYMid meet"` the viewBox scales uniformly and
                  * left-anchors inside the fixed box; once the observer matches the viewBox
                  * width to the rendered width the mapping is 1:1, so before measurement the
                  * content is undistorted (transient empty space on the right) rather than
                  * horizontally stretched.
                  */}
                <svg
                viewBox={`0 0 ${width} ${chartHeight}`}
                height={chartHeight}
                preserveAspectRatio="xMinYMid meet"
                role="img"
                aria-label={ariaLabel}
                onPointerDown={chrome.interactive ? handlePointerDown : undefined}
                onPointerMove={chrome.interactive ? handlePointerMove : undefined}
                onPointerLeave={chrome.interactive ? handlePointerLeave : undefined}
            >
                {chrome.showAxes && yTicks.map((tick, index) => (
                    <g key={`y-tick-${index}`}>
                        <line
                            className={styles.gridline}
                            x1={chrome.margin.left}
                            x2={width - chrome.margin.right}
                            y1={tick.y}
                            y2={tick.y}
                            strokeDasharray="6 6"
                        />
                        <text
                            className={styles.axis_label}
                            x={chrome.margin.left - 10}
                            y={tick.y + 4}
                            textAnchor="end"
                        >
                            {yAxisFormatter(tick.value)}
                        </text>
                    </g>
                ))}

                <line
                    className={styles.baseline}
                    x1={chrome.margin.left}
                    x2={width - chrome.margin.right}
                    y1={baselineY}
                    y2={baselineY}
                />

                {bars.map((bar, index) => {
                    const dimmed = tooltip ? tooltip.date.getTime() !== bar.categoryTime : false;
                    return (
                        <rect
                            key={`${bar.seriesId}-${bar.categoryTime}-${index}`}
                            className={cn(styles.bar, dimmed && styles['bar--dim'])}
                            x={bar.x}
                            y={bar.y}
                            width={bar.width}
                            height={bar.height}
                            rx={chrome.barRadius}
                            style={{ fill: bar.color }}
                        >
                            {chrome.interactive && (
                                <title>{`${bar.label}: ${yAxisFormatter(bar.value)}`}</title>
                            )}
                        </rect>
                    );
                })}

                {chrome.showAxes && xTicks.map((tick, index) => (
                    <text
                        key={`x-tick-${index}`}
                        className={styles.axis_label}
                        x={tick.centerX}
                        y={chartHeight - chrome.margin.bottom + 20}
                        textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
                    >
                        {xAxisFormatter(tick.date)}
                    </text>
                ))}
            </svg>

            {tooltip && (
                <div
                    ref={setTooltipNode}
                    className={styles.tooltip}
                    // Hide the single pre-measurement frame: until the effect reads
                    // the box width, the clamp ignores its half-width and an
                    // edge-hovered tooltip would briefly overflow before correcting.
                    style={{ left: `${tooltipLeftPx}px`, top: `${tooltipTopPx}px`, opacity: tooltipWidth === 0 ? 0 : 1 }}
                    role="presentation"
                >
                    <span className={styles.tooltip__label}>{tooltipDateFormatter(tooltip.date)}</span>
                    {tooltip.items.map(item => (
                        <div key={item.id} className={styles.tooltip__row}>
                            <span className={styles.tooltip__series}>
                                <span className={styles.tooltip__swatch} style={{ background: item.color }} />
                                {item.label}
                            </span>
                            <span>{yAxisFormatter(item.value)}</span>
                        </div>
                    ))}
                    {tooltipMetadataFormatter && tooltip.items.map(item => (
                        item.metadata
                            ? <div key={`${item.id}-meta`}>{tooltipMetadataFormatter(item.metadata)}</div>
                            : null
                    ))}
                </div>
            )}
            </div>

            {resolvedShowLegend && (
                <figcaption className={styles.legend}>
                    {series.filter(item => item.data.length > 0).map(item => {
                        const isHidden = hiddenSeries.has(item.id);
                        const color = seriesColors.get(item.id) ?? resolveColor(item.color, 0);
                        return (
                            <button
                                key={`legend-${item.id}`}
                                className={cn(styles.legend__item, isHidden && styles['legend__item--hidden'])}
                                onClick={() => toggleSeries(item.id)}
                                type="button"
                                aria-pressed={!isHidden}
                                title={isHidden ? `Show ${item.label}` : `Hide ${item.label}`}
                            >
                                <span
                                    className={styles.legend__dot}
                                    style={{ background: isHidden ? 'transparent' : color, borderColor: color }}
                                />
                                <span className={styles.legend__label}>{item.label}</span>
                                {item.legendValue != null && (
                                    <span className={styles.legend__value}>{item.legendValue}</span>
                                )}
                            </button>
                        );
                    })}
                </figcaption>
            )}
        </figure>
    );
}
