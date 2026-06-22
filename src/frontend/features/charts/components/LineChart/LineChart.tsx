'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { cn } from '../../../../lib/cn';
import styles from './LineChart.module.css';

/**
 * Individual data point for chart series.
 */
interface DataPoint {
    /** ISO date string or timestamp */
    date: string;
    /** Numeric value to plot */
    value: number;
    /** Optional metadata to display in tooltip */
    metadata?: Record<string, any>;
}

/**
 * Chart series configuration for multi-line charts.
 */
export interface ChartSeries {
    /** Unique identifier for the series */
    id: string;
    /** Display label for legend */
    label: string;
    /** Array of data points to plot */
    data: DataPoint[];
    /** Hex color code (defaults to palette if not specified) */
    color?: string;
    /** Whether to fill area under the line (default: true) */
    fill?: boolean;
    /**
     * Optional aggregate annotation rendered after the label in the legend only
     * (never the tooltip), letting the legend serve as a complete key — e.g. a
     * headline metric the host would otherwise render in a separate row.
     */
    legendValue?: ReactNode;
}

/**
 * Properties for the LineChart component.
 */
interface LineChartProps {
    /** Array of data series to plot */
    series: ChartSeries[];
    /**
     * Optional heading rendered above the chart. Lets a caller (e.g. a widget
     * surfacing an operator-set graph title) label the chart without wrapping it
     * in its own header. Omitted renders no title element.
     */
    title?: string;
    /** Chart height in pixels (default: 320) */
    height?: number;
    /** Custom formatter for Y-axis labels */
    yAxisFormatter?: (value: number) => string;
    /** Custom formatter for X-axis tick labels (also the tooltip date heading when no tooltipDateFormatter is given) */
    xAxisFormatter?: (value: Date) => string;
    /**
     * Custom formatter for the tooltip's date heading; falls back to
     * `xAxisFormatter` when omitted. Lets a chart keep compact relative axis
     * labels ("3h", "now") while the tooltip shows an absolute localized date —
     * matching the BarChart's tooltip behavior. The tooltip mounts only on
     * hover (client-only), so a localized value here is hydration-safe.
     */
    tooltipDateFormatter?: (value: Date) => string;
    /** Additional CSS class names */
    className?: string;
    /** Render the legend. Defaults to true; set false to suppress it. */
    showLegend?: boolean;
    /** Message to show when no data is available */
    emptyLabel?: string;
    /** Fixed minimum date for X-axis (prevents auto-scaling when data is sparse) */
    minDate?: Date;
    /** Fixed maximum date for X-axis (prevents auto-scaling when data is sparse) */
    maxDate?: Date;
    /** Fixed minimum value for Y-axis (overrides auto-calculated minimum) */
    yAxisMin?: number;
    /** Fixed maximum value for Y-axis (overrides auto-calculated maximum) */
    yAxisMax?: number;
}

/**
 * 2D point in chart coordinate space.
 */
interface PointShape {
    x: number;
    y: number;
}

/**
 * Normalized data point with chart coordinates.
 */
interface NormalizedPoint extends PointShape {
    date: Date;
    value: number;
    metadata?: Record<string, any>;
}

/**
 * Tooltip data item for a single series.
 */
interface TooltipDatum {
    label: string;
    value: number;
    color: string;
    metadata?: Record<string, any>;
}

/**
 * Complete tooltip state.
 */
interface TooltipState {
    x: number;
    y: number;
    date: Date;
    items: TooltipDatum[];
}

/**
 * Default color palette for series (cycles if more series than colors).
 */
const DEFAULT_COLORS = ['#7C9BFF', '#5CE1E6', '#FF9F6E', '#F06EF0'];

/**
 * Chart margins for axis labels and padding.
 */
const MARGIN = { top: 24, right: 32, bottom: 36, left: 64 };

/**
 * Width, in viewBox units, the chart assumes before its ResizeObserver measures
 * the real container. The server cannot measure layout, so SSR and the first
 * client render both use this fixed value — keeping the two renders byte-identical
 * (no hydration mismatch). Paired with a fixed pixel height and
 * `preserveAspectRatio="xMinYMid meet"` on the SVG, the later measured correction
 * only widens the viewBox horizontally; it never resizes the chart's box, which is
 * what previously produced the visible post-hydration "load". `meet` scales the
 * content uniformly and left-anchors it, so before measurement the chart renders
 * undistorted at its natural width with transient empty space on the right rather
 * than stretching text and lines to fill. 640 sits near the geometric mean of a
 * narrow widget column and a full-width page, bounding that transient gap in either
 * context.
 */
const SSR_DEFAULT_WIDTH = 640;

/**
 * Converts date string to Date object, handling various formats.
 *
 * Properly handles ISO 8601 timestamps with timezone information from the backend API.
 * The backend returns UTC timestamps in ISO format (e.g., "2025-10-13T01:00:00.000Z"),
 * which Date.parse() correctly interprets as UTC. The resulting Date object is then
 * displayed in the user's local timezone by the chart's xAxisFormatter.
 *
 * @param value - ISO date string or timestamp (should include timezone indicator)
 * @returns Parsed Date object representing the UTC time
 */
function toDate(value: string) {
    const time = Date.parse(value);
    if (Number.isNaN(time)) {
        return new Date(value);
    }
    return new Date(time);
}

/**
 * LineChart - Interactive SVG line chart with multi-series support
 *
 * Renders a responsive line chart with the following features:
 * - **Multiple series** - Plot multiple data series with distinct colors
 * - **Area fill** - Optional gradient fill under lines (configurable per series)
 * - **Interactive tooltip** - Hover to see values at each data point
 * - **Auto-scaling** - Axes automatically scale to data range
 * - **Zero-line rendering** - Prominent horizontal line at y=0 when data crosses zero
 * - **Responsive** - Uses ResizeObserver to adapt to container width
 * - **Custom formatters** - Format axis labels and tooltip values
 *
 * The chart automatically handles:
 * - Empty data states with custom message
 * - Single-point datasets (adds padding to avoid division by zero)
 * - Date parsing from various string formats
 * - Color cycling when series count exceeds palette size
 * - Zero-crossing detection for charts with positive and negative values
 *
 * Performance considerations:
 * - Uses `useMemo` to cache expensive coordinate calculations
 * - Memoizes normalized series data to avoid recalculation on hover
 * - ResizeObserver throttles width updates
 *
 * @param props - Component properties with series data and configuration
 * @returns A figure element containing SVG chart and legend
 */
export function LineChart({
    series,
    title,
    height = 320,
    yAxisFormatter = value => value.toLocaleString(),
    xAxisFormatter = value => value.toLocaleDateString(),
    tooltipDateFormatter,
    className,
    showLegend = true,
    emptyLabel = 'Not enough data to render a chart.',
    minDate: fixedMinDate,
    maxDate: fixedMaxDate,
    yAxisMin: fixedYMin,
    yAxisMax: fixedYMax
}: LineChartProps) {
    const containerRef = useRef<HTMLElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(SSR_DEFAULT_WIDTH);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);
    const [hiddenSeries, setHiddenSeries] = useState<Set<string>>(new Set());

    /**
     * Observes container width changes and updates chart responsively.
     * Disconnects observer on component unmount to prevent memory leaks.
     */
    useEffect(() => {
        if (!containerRef.current || typeof ResizeObserver === 'undefined') {
            return;
        }

        const observer = new ResizeObserver(entries => {
            const entry = entries[0];
            if (entry) {
                setContainerWidth(Math.max(320, Math.round(entry.contentRect.width)));
            }
        });

        observer.observe(containerRef.current);
        return () => observer.disconnect();
    }, []);

    /**
     * Calculates chart dimensions, scales, and normalized coordinates.
     *
     * This expensive computation is memoized to avoid recalculation on every
     * render. It:
     * 1. Filters out empty series
     * 2. Finds data range (min/max dates and values)
     * 3. Creates scale functions for X (time) and Y (value) axes
     * 4. Normalizes all data points to chart coordinate space
     * 5. Generates axis tick positions and labels
     * 6. Creates domain point lookup for tooltip interaction
     *
     * Returns null if no data available, triggering empty state display.
     */
    /**
     * Toggles visibility of a series by ID.
     * When toggled off, the series is hidden and Y-axis rescales.
     */
    const toggleSeries = (seriesId: string) => {
        setHiddenSeries(prev => {
            const next = new Set(prev);
            if (next.has(seriesId)) {
                next.delete(seriesId);
            } else {
                next.add(seriesId);
            }
            return next;
        });
    };

    const chartData = useMemo(() => {
        // Filter out empty series and hidden series
        const nonEmptySeries = series.filter(item => item.data.length > 0 && !hiddenSeries.has(item.id));
        if (!nonEmptySeries.length) {
            return null;
        }

        const allPoints = nonEmptySeries.flatMap(item => item.data.map(point => ({
            date: toDate(point.date),
            value: point.value
        })));

        // Use fixed dates if provided, otherwise calculate from data
        const minDate = fixedMinDate ?? new Date(Math.min(...allPoints.map(point => point.date.getTime())));
        const maxDate = fixedMaxDate ?? new Date(Math.max(...allPoints.map(point => point.date.getTime())));
        const minValue = Math.min(...allPoints.map(point => point.value));
        const maxValue = Math.max(...allPoints.map(point => point.value));

        const rangeX = maxDate.getTime() === minDate.getTime() ? 1 : maxDate.getTime() - minDate.getTime();

        // Use fixed Y-axis bounds if provided, otherwise calculate from data
        let minY: number;
        let maxY: number;

        if (fixedYMin !== undefined && fixedYMax !== undefined) {
            // Both min and max are fixed
            minY = fixedYMin;
            maxY = fixedYMax;
        } else if (fixedYMin !== undefined) {
            // Only min is fixed
            minY = fixedYMin;
            maxY = minValue === maxValue ? maxValue + 1 : Math.max(maxValue, minY + 1);
        } else if (fixedYMax !== undefined) {
            // Only max is fixed
            maxY = fixedYMax;
            minY = minValue === maxValue ? minValue - 1 : Math.min(minValue, maxY - 1);
        } else {
            // Auto-calculate both from data
            minY = minValue === maxValue ? minValue - 1 : minValue;
            maxY = minValue === maxValue ? maxValue + 1 : maxValue;
        }

        const rangeY = maxY - minY || 1;

        const width = Math.max(containerWidth, 320);
        const innerWidth = width - MARGIN.left - MARGIN.right;
        const innerHeight = height - MARGIN.top - MARGIN.bottom;

        const scaleX = (value: Date) =>
            MARGIN.left + ((value.getTime() - minDate.getTime()) / rangeX) * innerWidth;
        const scaleY = (value: number) => MARGIN.top + innerHeight - ((value - minY) / rangeY) * innerHeight;

        const normalizedSeries = nonEmptySeries.map((item, index) => {
            const color = item.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
            const points: NormalizedPoint[] = item.data.map(point => {
                const date = toDate(point.date);
                return {
                    x: scaleX(date),
                    y: scaleY(point.value),
                    date,
                    value: point.value,
                    metadata: point.metadata
                };
            });
            return { ...item, color, points };
        });

        const yTicks = Array.from({ length: 4 }).map((_, index) => {
            const value = minY + (rangeY / 3) * index;
            return {
                value,
                y: scaleY(value)
            };
        });

        /**
         * When zero-crossing is detected, ensure '0' appears as a Y-axis label.
         *
         * This provides an explicit visual reference that aligns with the zero-line,
         * making it clearer where positive values transition to negative values.
         * We check if 0 already exists in the ticks (within a small epsilon) to
         * avoid duplicate labels.
         */
        const showZeroLine = minY < 0 && maxY > 0;
        if (showZeroLine) {
            const hasZeroTick = yTicks.some(tick => Math.abs(tick.value) < 0.0001);
            if (!hasZeroTick) {
                yTicks.push({
                    value: 0,
                    y: scaleY(0)
                });
                // Sort ticks by value (descending) to maintain proper Y-axis ordering
                yTicks.sort((a, b) => b.value - a.value);
            }
        }

        const xTicks = [minDate, new Date((minDate.getTime() + maxDate.getTime()) / 2), maxDate];

        const domainPointLookup = new Map<number, { x: number; date: Date }>();
        normalizedSeries.forEach(series => {
            series.points.forEach(point => {
                domainPointLookup.set(point.date.getTime(), { x: point.x, date: point.date });
            });
        });

        const domainPoints = Array.from(domainPointLookup.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

        /**
         * Calculate zero-line Y coordinate for rendering when zero-crossing detected.
         *
         * When data includes both positive and negative values (zero-crossing metrics),
         * we render a solid horizontal line at y=0 to provide a clear visual reference
         * point. This helps users distinguish between positive deltas (above the line)
         * and negative deltas (below the line).
         *
         * The zero-line is rendered with:
         * - Higher opacity (0.3) than grid lines (0.05) for prominence
         * - Solid stroke (no dashes) to distinguish from grid lines
         * - Slightly thicker stroke (1.5px) for visibility
         */
        const zeroLineY = showZeroLine ? scaleY(0) : null;

        return {
            width,
            height,
            normalizedSeries,
            yTicks,
            xTicks,
            minDate,
            maxDate,
            minY,
            maxY,
            scaleY,
            domainPoints,
            zeroLineY
        };
    }, [series, height, containerWidth, fixedMinDate, fixedMaxDate, fixedYMin, fixedYMax, hiddenSeries]);

    if (!chartData) {
        return (
            <div className={cn(styles.chart, className)}>
                {title ? <h3 className={styles.chart__title}>{title}</h3> : null}
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

    const { width, height: chartHeight, normalizedSeries, yTicks, xTicks, domainPoints, zeroLineY } = chartData;

    /**
     * Handles pointer movement over the chart to show tooltips.
     *
     * Finds the nearest data point to the pointer X coordinate using linear
     * search (optimized for typical dataset sizes). Updates tooltip state
     * with all series values at that point.
     *
     * @param event - React mouse event from SVG element
     */
    const handlePointerMove = (event: React.MouseEvent<SVGSVGElement>) => {
        if (!chartData || !domainPoints.length) {
            return;
        }

        const bounds = event.currentTarget.getBoundingClientRect();
        const pointerX = event.clientX - bounds.left;

        let nearest = domainPoints[0];
        let minDistance = Math.abs(domainPoints[0].x - pointerX);
        for (let index = 1; index < domainPoints.length; index += 1) {
            const candidate = domainPoints[index];
            const distance = Math.abs(candidate.x - pointerX);
            if (distance < minDistance) {
                minDistance = distance;
                nearest = candidate;
            }
        }

        const items: TooltipDatum[] = normalizedSeries
            .map(series => {
                const point = series.points.find(p => p.date.getTime() === nearest.date.getTime());
                if (!point) {
                    return null;
                }
                const tooltipItem: TooltipDatum = {
                    label: series.label,
                    value: point.value,
                    color: series.color ?? '#7C9BFF',
                    metadata: point.metadata
                };
                return tooltipItem;
            })
            .filter((item): item is TooltipDatum => Boolean(item));

        if (!items.length) {
            setTooltip(null);
            return;
        }

        const anchorY = Math.min(...items.map(item => {
            const series = normalizedSeries.find(seriesItem => seriesItem.label === item.label);
            const point = series?.points.find(p => p.date.getTime() === nearest.date.getTime());
            return point?.y ?? MARGIN.top;
        }));

        setTooltip({
            x: nearest.x,
            y: anchorY,
            date: nearest.date,
            items
        });
    };

    /**
     * Hides tooltip when pointer leaves the chart area.
     */
    const handlePointerLeave = () => {
        setTooltip(null);
    };

    return (
        <figure ref={containerRef} className={cn(styles.chart, className)}>
            {title ? <h3 className={styles.chart__title}>{title}</h3> : null}
            {/*
              * Positioning context for the absolutely-positioned tooltip. The tooltip
              * uses `top: tooltip.y`, an SVG viewBox-unit Y coordinate that is only
              * valid measured from the SVG's top edge. The optional title is kept a
              * direct child of the figure (outside this wrapper), so the wrapper begins
              * exactly where the SVG does — a rendered title cannot push the SVG down
              * and shift every tooltip upward by the heading's height. The legend is
              * likewise left outside so it is not captured by the positioning context.
              */}
            <div className={styles.plot}>
                {/*
                  * Render at a fixed pixel height with a uniformly-scaled viewBox so the
                  * chart occupies its final box during SSR. Height no longer derives from
                  * the pre-measurement viewBox aspect ratio (CSS `height: auto`), which
                  * made the server paint the chart short and then grow it to full height
                  * after the ResizeObserver fired — the visible "loading" jump. With
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
                onMouseMove={handlePointerMove}
                onMouseLeave={handlePointerLeave}
            >
                <defs>
                    {normalizedSeries.map(item => (
                        <linearGradient id={`gradient-${item.id}`} key={`gradient-${item.id}`} x1="0" x2="0" y1="0" y2="1">
                            <stop offset="0%" stopColor={item.color} stopOpacity={item.fill === false ? 0 : 0.35} />
                            <stop offset="100%" stopColor={item.color} stopOpacity={0} />
                        </linearGradient>
                    ))}
                </defs>

                <line
                    x1={MARGIN.left}
                    x2={width - MARGIN.right}
                    y1={chartHeight - MARGIN.bottom}
                    y2={chartHeight - MARGIN.bottom}
                    stroke="rgba(255,255,255,0.08)"
                    strokeWidth={1}
                />

                {yTicks.map((tick, index) => (
                    <g key={`y-tick-${index}`}>
                        <line
                            x1={MARGIN.left}
                            x2={width - MARGIN.right}
                            y1={tick.y}
                            y2={tick.y}
                            stroke="rgba(255,255,255,0.05)"
                            strokeDasharray="6 6"
                        />
                        <text
                            x={MARGIN.left - 10}
                            y={tick.y + 4}
                            textAnchor="end"
                            fill="rgba(226,234,255,0.55)"
                            fontSize={12}
                        >
                            {yAxisFormatter(tick.value)}
                        </text>
                    </g>
                ))}

                {zeroLineY !== null && (
                    <line
                        x1={MARGIN.left}
                        x2={width - MARGIN.right}
                        y1={zeroLineY}
                        y2={zeroLineY}
                        stroke="rgba(255,255,255,0.05)"
                        strokeWidth={1.5}
                        strokeDasharray="none"
                    />
                )}

                {xTicks.map((tick, index) => (
                    <text
                        key={`x-tick-${index}`}
                        x={
                            index === 0
                                ? MARGIN.left
                                : index === xTicks.length - 1
                                    ? width - MARGIN.right
                                    : (MARGIN.left + width - MARGIN.right) / 2
                        }
                        y={chartHeight - MARGIN.bottom + 24}
                        fill="rgba(226,234,255,0.55)"
                        fontSize={12}
                        textAnchor={index === 0 ? 'start' : index === xTicks.length - 1 ? 'end' : 'middle'}
                    >
                        {xAxisFormatter(tick)}
                    </text>
                ))}

                {normalizedSeries.map(item => {
                    if (!item.points.length) {
                        return null;
                    }

                    const areaPath = item.points
                        .map((point, index) => `${index === 0 ? 'M' : 'L'}${point.x},${point.y}`)
                        .join(' ');

                    const closedAreaPath = `${areaPath} L${item.points[item.points.length - 1].x},${chartHeight - MARGIN.bottom} L${item.points[0].x},${chartHeight - MARGIN.bottom} Z`;

                    return (
                        <g key={item.id}>
                            {item.fill !== false && (
                                <path d={closedAreaPath} fill={`url(#gradient-${item.id})`} stroke="none" />
                            )}
                            <path
                                d={areaPath}
                                fill="none"
                                stroke={item.color}
                                strokeWidth={2.5}
                                strokeLinejoin="round"
                                strokeLinecap="round"
                            />
                            {item.points.map((point, index) => (
                                <circle
                                    key={`${item.id}-point-${index}`}
                                    cx={point.x}
                                    cy={point.y}
                                    r={3.4}
                                    fill={item.color}
                                    stroke="#0c1520"
                                    strokeWidth={1}
                                />
                            ))}
                        </g>
                    );
                })}
            </svg>

            {tooltip && (
                <div
                    className={styles.tooltip}
                    style={{ left: tooltip.x, top: tooltip.y }}
                    role="presentation"
                >
                    <span className={styles.tooltip__label}>{(tooltipDateFormatter ?? xAxisFormatter)(tooltip.date)}</span>
                    {tooltip.items.map(item => (
                        <div key={item.label} className={styles.tooltip__meta}>
                            <span style={{ color: item.color }}>{item.label}</span>
                            <span>{yAxisFormatter(item.value)}</span>
                        </div>
                    ))}
                    {tooltip.items[0]?.metadata && (
                        <div className={styles.tooltip__footer}>
                            {tooltip.items[0].metadata.blockRange && (
                                <div>Blocks: {tooltip.items[0].metadata.blockRange}</div>
                            )}
                            {tooltip.items[0].metadata.transactions !== undefined && (
                                <div>{tooltip.items[0].metadata.transactions.toLocaleString()} transactions</div>
                            )}
                        </div>
                    )}
                </div>
            )}
            </div>

            {showLegend && (
                <figcaption className={styles.legend}>
                    <div className={styles.legend__items}>
                        {series.filter(item => item.data.length > 0).map((item, index) => {
                            const isHidden = hiddenSeries.has(item.id);
                            const color = item.color ?? DEFAULT_COLORS[index % DEFAULT_COLORS.length];
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
                    </div>
                </figcaption>
            )}
        </figure>
    );
}
