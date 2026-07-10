'use client';

/**
 * @fileoverview Inflow vs outflow over time — an aggregated flow visualization that
 * is an industry-wide gap even on EVM (most tools show a flat list instead of
 * summarizing flow). Inflow climbs green above a shared zero baseline while outflow
 * drops red below it, so a period's net direction reads at a glance. Because the
 * ledger carries no USD valuation, TRX and USDT cannot share an axis, so a
 * denomination toggle switches between them rather than summing into one misleading
 * total. A precision selector re-buckets the same ledger by month, week, or day.
 * A counterparty dropdown — populated from the wallet's top counterparties (the
 * same ranked-by-frequency list the counterparties table shows) — scopes the flow
 * to money moved with a single address, so "how much do I move with this exchange"
 * reads off the same green-up/red-down chart.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight, SlidersHorizontal } from 'lucide-react';
import type { FlowGranularity, IWalletCounterparty, IWalletFlowBucket } from '@/types';
import { BarChart, type BarChartSeries } from '../../../../../features/charts';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Select } from '../../../../../components/ui/Select';
import { Input } from '../../../../../components/ui/Input';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { fetchWalletFlow } from '../../../api/account-history-user.api';
import { trxFromSun, truncateAddress, usdtFromRaw } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

/** Which denomination the chart currently plots. */
type FlowDenomination = 'trx' | 'usdt';

/**
 * The precision-selector options, finest first — matching the house norm where
 * every time selector (PortfolioHero, the traffic dashboards) leads with the
 * smallest unit and grows rightward. Order is presentational only; the default
 * resolution is set independently in `useState`.
 */
const GRANULARITIES: ReadonlyArray<{ value: FlowGranularity; label: string }> = [
    { value: 'day', label: '1day' },
    { value: 'week', label: '1week' },
    { value: 'month', label: '1mo' }
];

/** Locale-independent month abbreviations, for hydration-safe axis labels. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Props for {@link WalletFlowChart}.
 */
interface IWalletFlowChartProps {
    /** The owned wallet address, used to re-fetch flow at a finer precision. */
    address: string;
    /** Per-month inflow/outflow buckets from the SSR summary, oldest first. */
    flow: IWalletFlowBucket[];
    /**
     * The wallet's top counterparties (ranked by transaction count), reused
     * verbatim from the summary to populate the counterparty filter dropdown.
     */
    counterparties: IWalletCounterparty[];
    /**
     * Address → human-friendly label map resolved by the backend, shared with
     * the counterparties table so a dropdown option shows the same name (or the
     * truncated address on a miss) that the table does.
     */
    labels?: Record<string, string>;
}

/**
 * Build a bucket-label formatter for the active precision. Month buckets read as
 * `MMM YY`; week (Monday) and day buckets read as `DD MMM` so finer resolutions
 * stay legible. All fields are read in UTC against a fixed name table so the axis
 * label is identical on server and client (no locale/timezone drift).
 *
 * @param granularity - The active bucket width.
 * @returns A formatter mapping a bucket-start Date to its axis label.
 */
function makeFormatPeriod(granularity: FlowGranularity): (date: Date) => string {
    if (granularity === 'month') {
        return (date) => `${MONTH_NAMES[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
    }
    return (date) => `${String(date.getUTCDate()).padStart(2, '0')} ${MONTH_NAMES[date.getUTCMonth()]}`;
}

/**
 * Build the tooltip-heading formatter for the active precision. Each bucket is keyed
 * to its UTC start instant (`toStartOfMonth`/`toMonday`/`toDate`), so the heading must
 * also be read in UTC. The chart's default tooltip formatter re-reads that instant with
 * `toLocaleDateString`, converting the bucket's `00:00 UTC` start into local time and
 * slipping a month bucket back onto the last day of the previous period for any viewer
 * west of UTC — the bug this replaces. Reading every field via `getUTC*` against the
 * fixed `MONTH_NAMES` table keeps the heading identical to the UTC-based x-axis label.
 * Month buckets read as `MMM YYYY`; week (Monday) and day buckets read as `DD MMM YYYY`,
 * carrying the full year the compact x-axis omits so the hovered bucket is unambiguous.
 *
 * @param granularity - The active bucket width, selecting month vs finer-grained heading.
 * @returns A formatter mapping a bucket-start Date to its UTC tooltip heading.
 */
function makeFormatTooltipPeriod(granularity: FlowGranularity): (date: Date) => string {
    if (granularity === 'month') {
        return (date) => `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
    }
    return (date) => `${String(date.getUTCDate()).padStart(2, '0')} ${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/**
 * Upper bound on gap-fill iterations — a backstop against a malformed period string
 * producing an unbounded loop, never a real limit: ~16 years of daily buckets, well
 * beyond any wallet's stored history, so normal data is never truncated.
 */
const FLOW_GAP_FILL_LIMIT = 6000;

/**
 * Insert zero-valued buckets for every period missing between the first and last returned
 * bucket, making the chart's time axis continuous. The backend groups by period and
 * ClickHouse emits only periods that have rows, so an inactive month/week/day is absent
 * entirely — the chart would then place two active periods adjacent with no visual gap,
 * misreading a dormant stretch as unbroken activity. Filling the gap with explicit zeros
 * restores an honest, evenly-spaced timeline; the summed values in real buckets are
 * untouched.
 *
 * Every period is stepped and formatted in UTC as `YYYY-MM-DD` to match the backend's
 * `toString(toStartOfMonth|toMonday|toDate)` keys exactly, so a real bucket is reused by
 * key lookup (never duplicated) wherever one exists and a synthetic zero fills the rest.
 * Month steps land on the 1st, week steps advance 7 days from the first bucket's Monday,
 * day steps advance one day — each matching how the backend derived the key.
 *
 * @param buckets - The returned buckets, oldest first, possibly with gaps.
 * @param granularity - The active bucket width, selecting the step between periods.
 * @returns A gap-free bucket list, oldest first; the input unchanged when it has fewer than two buckets.
 */
function fillFlowGaps(buckets: IWalletFlowBucket[], granularity: FlowGranularity): IWalletFlowBucket[] {
    if (buckets.length < 2) {
        return buckets;
    }
    const byPeriod = new Map(buckets.map((bucket) => [bucket.period, bucket]));
    const toKey = (date: Date) => date.toISOString().slice(0, 10);
    const parse = (period: string) => {
        const [year, month, day] = period.split('-').map(Number);
        return new Date(Date.UTC(year, month - 1, day));
    };
    const advance = (date: Date) => {
        if (granularity === 'month') {
            return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1));
        }
        const step = granularity === 'week' ? 7 : 1;
        return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + step));
    };
    const lastKey = buckets[buckets.length - 1].period;
    const filled: IWalletFlowBucket[] = [];
    // Bail if the first period can't be parsed to a real date. `toKey` below calls
    // `toISOString()`, which throws `RangeError: Invalid time value` on an Invalid Date
    // and would crash this render-time memo. Backend periods are always well-formed, so
    // this only hardens the frontend/backend trust boundary against a malformed string.
    let cursor = parse(buckets[0].period);
    if (Number.isNaN(cursor.getTime())) {
        return buckets;
    }
    let guard = 0;
    while (toKey(cursor) <= lastKey && guard < FLOW_GAP_FILL_LIMIT) {
        const key = toKey(cursor);
        filled.push(byPeriod.get(key) ?? { period: key, trxInSun: 0, trxOutSun: 0, usdtInRaw: 0, usdtOutRaw: 0 });
        cursor = advance(cursor);
        guard += 1;
    }
    return filled;
}

/** Stable id for the mobile y-axis range modal so re-opening replaces it in place. */
const RANGE_MODAL_ID = 'wallet-flow-axis-range';

/**
 * Parse a viewer-typed axis bound into a chart domain number. An empty field means
 * "auto" — let the chart fit that edge to the data — so it yields undefined; a
 * non-numeric entry degrades to auto the same way rather than forcing a broken domain.
 * The value is in the active denomination's display unit, matching the plotted series
 * and the y-axis formatter, so no conversion is applied.
 *
 * @param raw - The raw input text for one axis bound.
 * @returns The parsed bound, or undefined to leave that edge auto-fitted.
 */
function parseAxisBound(raw: string): number | undefined {
    const trimmed = raw.trim();
    if (!trimmed) {
        return undefined;
    }
    const value = Number(trimmed);
    return Number.isFinite(value) ? value : undefined;
}

/**
 * Props for {@link AxisRangeFields}.
 */
interface IAxisRangeFieldsProps {
    /** Current min-bound text (display units); empty means auto-fit that edge. */
    min: string;
    /** Current max-bound text (display units); empty means auto-fit that edge. */
    max: string;
    /** Active denomination unit label, surfaced in each field's accessible name. */
    unit: string;
    /** Notified with the new min text on every keystroke. */
    onMinChange: (value: string) => void;
    /** Notified with the new max text on every keystroke. */
    onMaxChange: (value: string) => void;
}

/**
 * The two controlled y-axis bound inputs, shared by the inline desktop placement and
 * the mobile modal so the field markup and styling live in one place. Purely
 * controlled — it owns no state; the caller decides whether the values bind straight
 * to the chart (desktop, live) or to a modal draft (mobile, commit-on-Apply). The
 * bounds are optional and independent: leaving one blank auto-fits that edge.
 *
 * @param props - {@link IAxisRangeFieldsProps}.
 * @returns The labelled min/max input pair.
 */
function AxisRangeFields({ min, max, unit, onMinChange, onMaxChange }: IAxisRangeFieldsProps) {
    return (
        <span className={styles.range_fields}>
            <label className={styles.range_field}>
                <span className={styles.range_label}>Min</span>
                <Input
                    variant="ghost"
                    type="number"
                    inputMode="decimal"
                    className={styles.range_input}
                    value={min}
                    placeholder="auto"
                    aria-label={`Y-axis minimum (${unit})`}
                    onChange={(event) => onMinChange(event.target.value)}
                />
            </label>
            <label className={styles.range_field}>
                <span className={styles.range_label}>Max</span>
                <Input
                    variant="ghost"
                    type="number"
                    inputMode="decimal"
                    className={styles.range_input}
                    value={max}
                    placeholder="auto"
                    aria-label={`Y-axis maximum (${unit})`}
                    onChange={(event) => onMaxChange(event.target.value)}
                />
            </label>
        </span>
    );
}

/**
 * Props for {@link AxisRangeDialog}.
 */
interface IAxisRangeDialogProps {
    /** Min-bound text to seed the draft from. */
    initialMin: string;
    /** Max-bound text to seed the draft from. */
    initialMax: string;
    /** Active denomination unit label for the field accessible names and hint. */
    unit: string;
    /** Commit the edited bounds to the chart. */
    onApply: (min: string, max: string) => void;
    /** Dismiss the modal. */
    onClose: () => void;
}

/**
 * The mobile modal body for the y-axis range. It holds its own draft state because the
 * modal system snapshots content at open time — live parent-controlled inputs would
 * freeze — so the fields edit a local copy and push it up only on Apply. Clear empties
 * both bounds (back to auto-fit); Apply commits the draft and closes.
 *
 * @param props - {@link IAxisRangeDialogProps}.
 * @returns The modal body with the range fields and its actions.
 */
function AxisRangeDialog({ initialMin, initialMax, unit, onApply, onClose }: IAxisRangeDialogProps) {
    const [min, setMin] = useState(initialMin);
    const [max, setMax] = useState(initialMax);
    return (
        <div className={styles.range_dialog}>
            <AxisRangeFields min={min} max={max} unit={unit} onMinChange={setMin} onMaxChange={setMax} />
            <p className="text-muted">Leave a field blank to auto-fit that edge. Values are in {unit}.</p>
            <div className={styles.range_dialog_actions}>
                <Button variant="ghost" size="sm" onClick={() => { setMin(''); setMax(''); }}>
                    Clear
                </Button>
                <Button variant="primary" size="sm" onClick={() => { onApply(min, max); onClose(); }}>
                    Apply
                </Button>
            </div>
        </div>
    );
}

/**
 * Render inflow/outflow as a diverging column chart — green up, red down, meeting
 * at a zero baseline — with a precision selector (1mo/1week/1day) and a TRX⇄USDT
 * denomination toggle in the chart's header.
 *
 * The monthly view arrives from the SSR summary as the `flow` prop, so the initial
 * render shows real data with no loading flash. Switching precision is a
 * user-triggered action, so a brief load while the finer series fetches is
 * acceptable; the previous series stays on screen until the new one lands.
 *
 * @param props - {@link IWalletFlowChartProps}.
 * @returns The flow chart section.
 */
export function WalletFlowChart({ address, flow, counterparties, labels }: IWalletFlowChartProps) {
    const [denomination, setDenomination] = useState<FlowDenomination>('trx');
    const [granularity, setGranularity] = useState<FlowGranularity>('month');
    const [counterparty, setCounterparty] = useState<string>('');
    const [buckets, setBuckets] = useState<IWalletFlowBucket[]>(flow);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [rangeMin, setRangeMin] = useState('');
    const [rangeMax, setRangeMax] = useState('');
    const { open, close } = useModal();

    // Re-bucket when precision or the counterparty filter changes. The SSR summary
    // carries only the unfiltered monthly view, so it can seed the chart only for
    // the default month + all-counterparties case — reusing the prop there keeps
    // the initial mount flash-free. Any finer precision or a selected counterparty
    // must re-fetch. A cancelled flag drops a stale response when the selection is
    // switched mid-flight.
    useEffect(() => {
        if (granularity === 'month' && !counterparty) {
            setBuckets(flow);
            setError(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchWalletFlow(address, granularity, counterparty || undefined)
            .then((next) => {
                if (!cancelled) {
                    setBuckets(next);
                }
            })
            .catch(() => {
                if (!cancelled) {
                    setError('Could not load flow at this resolution.');
                }
            })
            .finally(() => {
                if (!cancelled) {
                    setLoading(false);
                }
            });
        return () => {
            cancelled = true;
        };
    }, [address, granularity, counterparty, flow]);

    // Fill dormant periods with zero buckets so the axis is a continuous timeline
    // rather than a skip-list of active periods. Keyed on the fetched data and the
    // granularity that shapes the step; recomputed on either change.
    const filledBuckets = useMemo(() => fillFlowGaps(buckets, granularity), [buckets, granularity]);

    // Recompute the two series only when the data or denomination changes. "In"
    // stays positive (green, above the baseline); "Out" is negated (red, below the
    // baseline). With the chart's stacked layout the signed pair renders as one
    // column per period, splitting at the middle zero line.
    const series = useMemo<BarChartSeries[]>(() => {
        const toValue = denomination === 'trx'
            ? { inField: 'trxInSun' as const, outField: 'trxOutSun' as const, convert: trxFromSun }
            : { inField: 'usdtInRaw' as const, outField: 'usdtOutRaw' as const, convert: usdtFromRaw };
        return [
            {
                id: 'in',
                label: 'In',
                color: 'var(--color-success)',
                data: filledBuckets.map((bucket) => ({ date: bucket.period, value: toValue.convert(bucket[toValue.inField]) }))
            },
            {
                id: 'out',
                label: 'Out',
                color: 'var(--color-danger)',
                data: filledBuckets.map((bucket) => ({ date: bucket.period, value: -toValue.convert(bucket[toValue.outField]) }))
            }
        ];
    }, [filledBuckets, denomination]);

    const unit = denomination === 'trx' ? 'TRX' : 'USDT';
    const formatPeriod = useMemo(() => makeFormatPeriod(granularity), [granularity]);
    const formatTooltipPeriod = useMemo(() => makeFormatTooltipPeriod(granularity), [granularity]);

    // Manual y-axis bounds are optional and independent — either edge may stay auto.
    // A fully-specified pair is honored only when min < max; an inverted or equal pair
    // is ignored (falls back to auto-fit) rather than rendering a broken or empty domain.
    const boundMin = parseAxisBound(rangeMin);
    const boundMax = parseAxisBound(rangeMax);
    const boundsValid = boundMin === undefined || boundMax === undefined || boundMin < boundMax;
    const appliedYMin = boundsValid ? boundMin : undefined;
    const appliedYMax = boundsValid ? boundMax : undefined;

    /**
     * Switch the plotted denomination and drop any manual y-axis bounds. TRX and USDT
     * sit on different scales with no shared axis, so a bound typed for one is
     * meaningless for the other; clearing on switch stops a stale TRX ceiling from
     * silently clipping the USDT view (and vice versa).
     *
     * @param next - The denomination to plot.
     */
    const changeDenomination = (next: FlowDenomination) => {
        setDenomination(next);
        setRangeMin('');
        setRangeMax('');
    };

    /**
     * Open the mobile modal that houses the y-axis range fields. On narrow containers
     * the inline min/max inputs are hidden — they crowd the counterparty and toggle
     * controls off the header row — so this button is the only way in. The modal seeds
     * its draft from the current bounds and commits them on Apply.
     */
    const openRangeModal = () => {
        open({
            id: RANGE_MODAL_ID,
            title: 'Y-axis range',
            size: 'sm',
            content: (
                <AxisRangeDialog
                    initialMin={rangeMin}
                    initialMax={rangeMax}
                    unit={unit}
                    onApply={(min, max) => {
                        setRangeMin(min);
                        setRangeMax(max);
                    }}
                    onClose={() => close(RANGE_MODAL_ID)}
                />
            )
        });
    };

    const actions = (
        <span className={styles.flow_actions}>
            {counterparties.length > 0 && (
                <Select
                    variant="ghost"
                    value={counterparty}
                    onChange={(event) => setCounterparty(event.target.value)}
                    disabled={loading}
                    aria-label="Filter flow by counterparty"
                >
                    <option value="">All counterparties</option>
                    {counterparties.map((option) => (
                        <option key={option.address} value={option.address}>
                            {labels?.[option.address] ?? truncateAddress(option.address)}
                        </option>
                    ))}
                </Select>
            )}
            <span className={styles.flow_toggle}>
                {GRANULARITIES.map((option) => (
                    <Button
                        key={option.value}
                        variant={granularity === option.value ? 'secondary' : 'ghost'}
                        size="xs"
                        disabled={loading}
                        onClick={() => setGranularity(option.value)}
                    >
                        {option.label}
                    </Button>
                ))}
            </span>
            <span className={styles.flow_toggle}>
                <Button variant={denomination === 'trx' ? 'secondary' : 'ghost'} size="xs" onClick={() => changeDenomination('trx')}>
                    TRX
                </Button>
                <Button variant={denomination === 'usdt' ? 'secondary' : 'ghost'} size="xs" onClick={() => changeDenomination('usdt')}>
                    USDT
                </Button>
            </span>
            <span className={styles.range_inline}>
                <AxisRangeFields
                    min={rangeMin}
                    max={rangeMax}
                    unit={unit}
                    onMinChange={setRangeMin}
                    onMaxChange={setRangeMax}
                />
            </span>
            <span className={styles.range_button}>
                <Button variant="ghost" size="xs" onClick={openRangeModal} aria-label="Set Y-axis range">
                    <SlidersHorizontal size={14} aria-hidden /> Range
                </Button>
            </span>
        </span>
    );

    return (
        <Card padding="md">
            <BarChart
                series={series}
                title="Inflow / outflow"
                actions={actions}
                layout="stacked"
                height={260}
                xAxisFormatter={formatPeriod}
                tooltipDateFormatter={formatTooltipPeriod}
                yAxisMin={appliedYMin}
                yAxisMax={appliedYMax}
                yAxisFormatter={(value) => `${Math.abs(value).toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unit}`}
                emptyLabel={`No ${unit} inflow or outflow recorded.`}
            />
            {error ? (
                <p className="alert">{error}</p>
            ) : (
                <p className="text-muted">
                    <ArrowLeftRight size={14} aria-hidden /> Inflow rises green above the zero line, outflow drops red below it.
                    Values are shown per token — not converted to a common currency.
                </p>
            )}
        </Card>
    );
}
