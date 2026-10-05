/**
 * PriceRail — listed values and observed values on one horizontal scale.
 *
 * Stating an advertised price and an observed price as two equal numbers side
 * by side leaves the reader to work out how they relate, and gives no sense of
 * where the observed price sits among the options a buyer can actually choose.
 * A rail answers that at a glance: the listed values are ticks on one line, the
 * band between the cheapest and the dearest is shaded, and each observed value
 * is a marker on the same scale. A reader sees immediately whether people paid
 * near the cheapest option or near the top of the range.
 *
 * Ticks and markers are plain numbers on one linear axis and the caller
 * supplies the formatting, so the rail knows nothing about currencies, units,
 * or what the ticks stand for.
 *
 * Keep marker labels short (a value and a few words): each takes one line under
 * the rail and wraps only when the rail is too narrow for it.
 *
 * Tick labels that would overlap are dropped from the label row. The tick mark
 * stays on the line and keeps its value in a tooltip, so a range whose values
 * sit a few percent apart still reads cleanly at a narrow width.
 *
 * It holds no state and reads no browser API, so it renders the same on the
 * server and the client. Published to plugins on `context.charts` because it is
 * a data visualization; it lives under `components/ui` because the legacy
 * `features/charts` directory takes no new work.
 *
 * First built in the resource-markets plugin for its market detail page and
 * moved into core unchanged.
 *
 * @module components/ui/PriceRail
 */

import type { IPriceRailMarker, IPriceRailProps, IPriceRailTick } from '@/types';
import { cn } from '../../../lib/cn';
import styles from './PriceRail.module.scss';

/**
 * Smallest gap, as a share of the rail, between two tick labels before the
 * second is dropped. Sized so two short labels ("1h", "3h") with their values
 * under them do not touch at the narrowest width the rail is laid out for.
 */
const MIN_TICK_LABEL_GAP_PERCENT = 9;

/**
 * Share of the rail inside which a label aligns to the nearer edge instead of
 * centring on its position, so it never runs off the end of the rail.
 */
const EDGE_ALIGN_PERCENT = 14;

/**
 * Padding added beyond the outermost values, as a share of the span, so the
 * end ticks and markers do not sit flush against the rail's ends.
 */
const RANGE_PADDING_SHARE = 0.06;

/**
 * Maps a marker's tone to the class that colours it. A lookup rather than a
 * conditional chain so a tone added to the union without a colour behind it
 * fails the type check.
 */
const markerToneClass: Record<NonNullable<IPriceRailMarker['tone']>, string> = {
    neutral: styles.tone_neutral,
    success: styles.tone_success,
    warning: styles.tone_warning
};

/**
 * Render the price rail.
 *
 * @param props - Ticks, markers, value formatter, band caption, unit, and
 *        accessible label, as described on `IPriceRailProps`.
 * @returns The rail, or null when there is nothing to place on it, so a caller
 *          can render it unconditionally.
 *
 * @example
 * ```tsx
 * <PriceRail
 *     label="Listed and paid prices"
 *     ticks={[{ key: '1h', label: '1h', value: 2.1 }, { key: '1d', label: '1d', value: 3.4 }]}
 *     markers={[{ key: 'paid', label: 'median paid', value: 2.6, tone: 'success' }]}
 *     formatValue={value => value.toFixed(2)}
 *     bandLabel="Listed range"
 *     unit="TRX per transfer"
 * />
 * ```
 */
export function PriceRail({ ticks, markers, formatValue, bandLabel, unit, label }: IPriceRailProps) {
    const sortedTicks = [...ticks].sort((a, b) => a.value - b.value);
    const values = [...sortedTicks.map(tick => tick.value), ...markers.map(marker => marker.value)];
    const scale = buildScale(values);
    const labelled = pickLabelledTicks(sortedTicks, scale);
    const bandStart = sortedTicks.length > 0 ? scale(sortedTicks[0].value) : null;
    const bandEnd = sortedTicks.length > 0 ? scale(sortedTicks[sortedTicks.length - 1].value) : null;

    return values.length === 0 ? null : (
        <figure className={styles.rail} aria-label={label}>
            <div className={styles.tick_row}>
                {/* In-flow twin of a label, invisible, so the row reserves its height. */}
                <span className={cn(styles.tick_label, styles.tick_label__spacer)} aria-hidden="true">
                    <span className={styles.tick_term}>0</span>
                    <span className={styles.tick_value}>0</span>
                </span>
                {sortedTicks
                    .filter(tick => labelled.has(tick.key))
                    .map(tick => (
                        <span
                            key={tick.key}
                            className={cn(styles.tick_label, alignClass(scale(tick.value)))}
                            style={{ left: `${scale(tick.value)}%` }}
                        >
                            <span className={styles.tick_term}>{tick.label}</span>
                            <span className={styles.tick_value}>{formatValue(tick.value)}</span>
                        </span>
                    ))}
            </div>

            <div className={styles.track}>
                {bandStart !== null && bandEnd !== null && (
                    <span
                        className={styles.band}
                        style={{ left: `${bandStart}%`, width: `${Math.max(bandEnd - bandStart, 0)}%` }}
                        aria-hidden="true"
                    />
                )}
                {sortedTicks.map(tick => (
                    <span
                        key={tick.key}
                        className={styles.tick_mark}
                        style={{ left: `${scale(tick.value)}%` }}
                        title={`${tick.label}: ${formatValue(tick.value)} ${unit}`}
                        aria-hidden="true"
                    />
                ))}
                {markers.map(marker => (
                    <span
                        key={marker.key}
                        className={cn(styles.marker_dot, markerToneClass[marker.tone ?? 'neutral'])}
                        style={{ left: `${scale(marker.value)}%` }}
                        aria-hidden="true"
                    />
                ))}
            </div>

            {markers.map(marker => (
                <div key={marker.key} className={styles.marker_row}>
                    {/* In-flow invisible copy reserves the row's height; the visible copy is positioned. */}
                    <span className={cn(styles.marker_label, styles.marker_label__spacer)} aria-hidden="true">
                        <span className={styles.marker_value}>{formatValue(marker.value)}</span>{' '}
                        <span className={styles.marker_text}>{marker.label}</span>
                    </span>
                    <span
                        className={cn(styles.marker_label, alignClass(scale(marker.value)))}
                        style={{ left: `${scale(marker.value)}%` }}
                    >
                        <span className={cn(styles.marker_value, markerToneClass[marker.tone ?? 'neutral'])}>
                            {formatValue(marker.value)}
                        </span>{' '}
                        <span className={styles.marker_text}>{marker.label}</span>
                    </span>
                </div>
            ))}

            <figcaption className={styles.caption}>
                <span className={styles.caption_item}>
                    <span className={styles.swatch} aria-hidden="true" />
                    {bandLabel}
                </span>
                <span className={styles.caption_item}>{unit}</span>
            </figcaption>
        </figure>
    );
}

/**
 * Build the function that places a value on the rail.
 *
 * The axis is linear between the smallest and largest value with a little
 * padding beyond each, so the shaded band reads as a proportion of the range
 * and the end ticks do not sit on the rail's ends. A single value, or several
 * equal ones, is centred rather than divided by a zero span.
 *
 * @param values - Every tick and marker value, which together set the axis range.
 * @returns A function from a value to its position as a percentage of the rail.
 */
function buildScale(values: number[]): (value: number) => number {
    const lo = values.length > 0 ? Math.min(...values) : 0;
    const hi = values.length > 0 ? Math.max(...values) : 0;
    const span = hi - lo;
    const pad = span * RANGE_PADDING_SHARE;
    const start = lo - pad;
    const width = span + pad * 2;

    /**
     * Place one value on the rail.
     *
     * @param value - A tick or marker value in the caller's unit.
     * @returns The value's position as a percentage of the rail's width.
     */
    const scale = (value: number): number => (width > 0 ? ((value - start) / width) * 100 : 50);
    return scale;
}

/**
 * Choose which ticks keep their label so no two labels overlap.
 *
 * Works left to right, keeping a label only when it is far enough from the
 * last one kept. The rightmost tick keeps its label too, displacing the one
 * before it if they are too close, because the highest listed value is one of
 * the two figures a reader most needs from the range. The one exception is when
 * the only label it could displace is the leftmost: the lowest value matters
 * more, so it stays and the rightmost keeps only its tooltip.
 *
 * @param ticks - Ticks sorted by value, so neighbours on the rail are neighbours in the array.
 * @param scale - Maps a value to its position on the rail, used to measure the gap between labels.
 * @returns The keys of the ticks whose labels are shown.
 */
function pickLabelledTicks(ticks: IPriceRailTick[], scale: (value: number) => number): Set<string> {
    const kept: IPriceRailTick[] = [];
    for (const tick of ticks) {
        const last = kept[kept.length - 1];
        if (!last || scale(tick.value) - scale(last.value) >= MIN_TICK_LABEL_GAP_PERCENT) {
            kept.push(tick);
        }
    }
    const final = ticks[ticks.length - 1];
    const previous = kept[kept.length - 1];
    if (final && previous && previous !== final) {
        const collides = scale(final.value) - scale(previous.value) < MIN_TICK_LABEL_GAP_PERCENT;
        if (!collides) {
            kept.push(final);
        } else if (kept.length > 1) {
            kept.pop();
            kept.push(final);
        }
    }
    return new Set(kept.map(tick => tick.key));
}

/**
 * Pick how a label anchors to its position, so labels near either end stay on the rail.
 *
 * @param position - The label's position as a percentage of the rail, which decides whether it is near an edge.
 * @returns The alignment class for that position.
 */
function alignClass(position: number): string {
    let className = styles.align_center;
    if (position < EDGE_ALIGN_PERCENT) {
        className = styles.align_start;
    } else if (position > 100 - EDGE_ALIGN_PERCENT) {
        className = styles.align_end;
    }
    return className;
}
