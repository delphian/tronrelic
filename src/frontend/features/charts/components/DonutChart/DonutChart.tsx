'use client';

/**
 * @fileoverview A dependency-free SVG donut chart for portfolio allocation.
 *
 * The codebase had no pie/donut primitive, and allocation is the one portfolio
 * visual a bar or line cannot express — the share each asset is of net worth. It
 * is a pure render of computed arc paths (no measurement, no randomness, no
 * dates), so it is hydration-safe and renders identically on server and client.
 * Colors fall back to the shared chart palette so it matches the line/bar charts.
 */

import type { CSSProperties } from 'react';

/** One allocation slice. */
export interface DonutSlice {
    /** Human label (asset symbol). */
    label: string;
    /** Slice magnitude; the chart normalizes magnitudes to fractions itself. */
    value: number;
    /** Optional explicit color; defaults to the chart palette by index. */
    color?: string;
}

/**
 * Props for {@link DonutChart}.
 */
interface IDonutChartProps {
    /** Slices to render, largest-first recommended for legible ordering. */
    slices: DonutSlice[];
    /** Outer diameter in px. */
    size?: number;
    /** Ring thickness in px. */
    thickness?: number;
    /** Large text in the hole (e.g. total value). */
    centerLabel?: string;
    /** Small caption under the center label (e.g. "Net worth"). */
    centerCaption?: string;
    /** Shown when there is nothing to chart. */
    emptyLabel?: string;
}

/** Default ring colors, aligned with the shared chart palette tokens. */
const PALETTE = [
    'var(--chart-color-1)',
    'var(--chart-color-2)',
    'var(--chart-color-3)',
    'var(--chart-color-4)',
    'var(--chart-color-5)',
    'var(--chart-color-6)',
    'var(--chart-color-7)',
    'var(--chart-color-8)'
];

/**
 * Convert a polar angle (degrees, measured clockwise from the top) to a cartesian
 * point on a circle — the primitive every arc endpoint is built from.
 *
 * @param cx - Circle center x.
 * @param cy - Circle center y.
 * @param radius - Circle radius.
 * @param angleDeg - Angle in degrees from the top, clockwise.
 * @returns The `{ x, y }` point.
 */
function polar(cx: number, cy: number, radius: number, angleDeg: number): { x: number; y: number } {
    const rad = ((angleDeg - 90) * Math.PI) / 180;
    return { x: cx + radius * Math.cos(rad), y: cy + radius * Math.sin(rad) };
}

/**
 * Build the SVG path for one donut segment between two angles.
 *
 * @param cx - Center x.
 * @param cy - Center y.
 * @param rOuter - Outer radius.
 * @param rInner - Inner radius.
 * @param startAngle - Segment start angle (deg from top).
 * @param endAngle - Segment end angle (deg from top).
 * @returns The SVG path `d` string.
 */
function segmentPath(cx: number, cy: number, rOuter: number, rInner: number, startAngle: number, endAngle: number): string {
    const largeArc = endAngle - startAngle > 180 ? 1 : 0;
    const oStart = polar(cx, cy, rOuter, startAngle);
    const oEnd = polar(cx, cy, rOuter, endAngle);
    const iEnd = polar(cx, cy, rInner, endAngle);
    const iStart = polar(cx, cy, rInner, startAngle);
    return [
        `M ${oStart.x} ${oStart.y}`,
        `A ${rOuter} ${rOuter} 0 ${largeArc} 1 ${oEnd.x} ${oEnd.y}`,
        `L ${iEnd.x} ${iEnd.y}`,
        `A ${rInner} ${rInner} 0 ${largeArc} 0 ${iStart.x} ${iStart.y}`,
        'Z'
    ].join(' ');
}

/**
 * Render an allocation donut with an optional center label.
 *
 * @param props - {@link IDonutChartProps}.
 * @returns The donut SVG, or an empty-state message.
 */
export function DonutChart({
    slices,
    size = 180,
    thickness = 28,
    centerLabel,
    centerCaption,
    emptyLabel = 'No allocation'
}: IDonutChartProps) {
    const total = slices.reduce((sum, slice) => sum + Math.max(0, slice.value), 0);
    if (total <= 0) {
        return <p className="text-muted">{emptyLabel}</p>;
    }

    const cx = size / 2;
    const cy = size / 2;
    const rOuter = size / 2;
    const rInner = rOuter - thickness;
    const centerStyle: CSSProperties = { fontSize: 'var(--font-size-heading-sm)', fontWeight: 'var(--font-weight-bold)' };

    let cursor = 0;
    const segments = slices
        .filter((slice) => slice.value > 0)
        .map((slice, index) => {
            const fraction = slice.value / total;
            const start = cursor * 360;
            cursor += fraction;
            // Pull a hair short of a full 360 so a single 100% slice still renders.
            const end = Math.min(cursor * 360, 359.999);
            return {
                d: segmentPath(cx, cy, rOuter, rInner, start, end),
                color: slice.color ?? PALETTE[index % PALETTE.length],
                key: `${slice.label}-${index}`
            };
        });

    return (
        <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Allocation breakdown">
            {segments.map((segment) => (
                <path key={segment.key} d={segment.d} fill={segment.color} />
            ))}
            {(centerLabel || centerCaption) && (
                <>
                    {centerLabel && (
                        <text x={cx} y={centerCaption ? cy - 2 : cy + 5} textAnchor="middle" fill="var(--color-text)" style={centerStyle}>
                            {centerLabel}
                        </text>
                    )}
                    {centerCaption && (
                        <text x={cx} y={cy + 16} textAnchor="middle" fill="var(--color-text-muted)" style={{ fontSize: 'var(--font-size-caption)' }}>
                            {centerCaption}
                        </text>
                    )}
                </>
            )}
        </svg>
    );
}
