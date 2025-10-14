'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
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
}

/**
 * Properties for the LineChart component.
 */
interface LineChartProps {
    /** Array of data series to plot */
    series: ChartSeries[];
    /** Chart height in pixels (default: 320) */
    height?: number;
    /** Custom formatter for Y-axis labels */
    yAxisFormatter?: (value: number) => string;
    /** Custom formatter for X-axis and tooltip dates */
    xAxisFormatter?: (value: Date) => string;
    /** Additional CSS class names */
    className?: string;
    /** Message to show when no data is available */
    emptyLabel?: string;
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
}

/**
 * Tooltip data item for a single series.
 */
interface TooltipDatum {
    label: string;
    value: number;
    color: string;
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
const MARGIN = { top: 24, right: 32, bottom: 36, left: 54 };

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
 * - **Responsive** - Uses ResizeObserver to adapt to container width
 * - **Custom formatters** - Format axis labels and tooltip values
 *
 * The chart automatically handles:
 * - Empty data states with custom message
 * - Single-point datasets (adds padding to avoid division by zero)
 * - Date parsing from various string formats
 * - Color cycling when series count exceeds palette size
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
    height = 320,
    yAxisFormatter = value => value.toLocaleString(),
    xAxisFormatter = value => value.toLocaleDateString(),
    className,
    emptyLabel = 'Not enough data to render a chart.'
}: LineChartProps) {
    const containerRef = useRef<HTMLElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(860);
    const [tooltip, setTooltip] = useState<TooltipState | null>(null);

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
    const chartData = useMemo(() => {
        const nonEmptySeries = series.filter(item => item.data.length > 0);
        if (!nonEmptySeries.length) {
            return null;
        }

        const allPoints = nonEmptySeries.flatMap(item => item.data.map(point => ({
            date: toDate(point.date),
            value: point.value
        })));

        const minDate = new Date(Math.min(...allPoints.map(point => point.date.getTime())));
        const maxDate = new Date(Math.max(...allPoints.map(point => point.date.getTime())));
        const minValue = Math.min(...allPoints.map(point => point.value));
        const maxValue = Math.max(...allPoints.map(point => point.value));

        const rangeX = maxDate.getTime() === minDate.getTime() ? 1 : maxDate.getTime() - minDate.getTime();
        const minY = minValue === maxValue ? minValue - 1 : minValue;
        const maxY = minValue === maxValue ? maxValue + 1 : maxValue;
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
                    value: point.value
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

        const xTicks = [minDate, new Date((minDate.getTime() + maxDate.getTime()) / 2), maxDate];

        const domainPointLookup = new Map<number, { x: number; date: Date }>();
        normalizedSeries.forEach(series => {
            series.points.forEach(point => {
                domainPointLookup.set(point.date.getTime(), { x: point.x, date: point.date });
            });
        });

        const domainPoints = Array.from(domainPointLookup.values()).sort((a, b) => a.date.getTime() - b.date.getTime());

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
            domainPoints
        };
    }, [series, height, containerWidth]);

    if (!chartData) {
        return <div className={cn(styles.chart, className)}>{emptyLabel}</div>;
    }

    const { width, height: chartHeight, normalizedSeries, yTicks, xTicks, domainPoints } = chartData;

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
                return {
                    label: series.label,
                    value: point.value,
                    color: series.color ?? '#7C9BFF'
                } satisfies TooltipDatum;
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
            <svg
                viewBox={`0 0 ${width} ${chartHeight}`}
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
                    <span className={styles.tooltip__label}>{xAxisFormatter(tooltip.date)}</span>
                    {tooltip.items.map(item => (
                        <div key={item.label} className={styles.tooltip__meta}>
                            <span style={{ color: item.color }}>{item.label}</span>
                            <span>{yAxisFormatter(item.value)}</span>
                        </div>
                    ))}
                </div>
            )}

            <figcaption className={styles.legend}>
                <div className={styles.legend__items}>
                    {normalizedSeries.map(item => (
                        <div key={`legend-${item.id}`} className={styles.legend__item}>
                            <span
                                className={styles.legend__dot}
                                style={{ background: item.color }}
                            />
                            <span className={styles.legend__label}>{item.label}</span>
                        </div>
                    ))}
                </div>
            </figcaption>
        </figure>
    );
}
