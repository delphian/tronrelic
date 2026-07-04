'use client';

/**
 * @fileoverview Inflow vs outflow over time — an aggregated flow visualization that
 * is an industry-wide gap even on EVM (most tools show a flat list instead of
 * summarizing flow). Inflow climbs green above a shared zero baseline while outflow
 * drops red below it, so a period's net direction reads at a glance. Because the
 * ledger carries no USD valuation, TRX and USDT cannot share an axis, so a
 * denomination toggle switches between them rather than summing into one misleading
 * total. A precision selector re-buckets the same ledger by month, week, or day.
 */

import { useEffect, useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { FlowGranularity, IWalletFlowBucket } from '@/types';
import { BarChart, type BarChartSeries } from '../../../../../features/charts';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { fetchWalletFlow } from '../../../api/account-history-user.api';
import { trxFromSun, usdtFromRaw } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

/** Which denomination the chart currently plots. */
type FlowDenomination = 'trx' | 'usdt';

/** The precision-selector options, coarsest first. */
const GRANULARITIES: ReadonlyArray<{ value: FlowGranularity; label: string }> = [
    { value: 'month', label: '1mo' },
    { value: 'week', label: '1week' },
    { value: 'day', label: '1day' }
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
export function WalletFlowChart({ address, flow }: IWalletFlowChartProps) {
    const [denomination, setDenomination] = useState<FlowDenomination>('trx');
    const [granularity, setGranularity] = useState<FlowGranularity>('month');
    const [buckets, setBuckets] = useState<IWalletFlowBucket[]>(flow);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Re-bucket when precision changes. The monthly view is already present from
    // the SSR summary, so selecting it reuses the prop rather than re-fetching —
    // this also covers the initial mount, keeping the first render flash-free. A
    // cancelled flag drops a stale response when precision is switched mid-flight.
    useEffect(() => {
        if (granularity === 'month') {
            setBuckets(flow);
            setError(null);
            setLoading(false);
            return;
        }
        let cancelled = false;
        setLoading(true);
        setError(null);
        fetchWalletFlow(address, granularity)
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
    }, [address, granularity, flow]);

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
                data: buckets.map((bucket) => ({ date: bucket.period, value: toValue.convert(bucket[toValue.inField]) }))
            },
            {
                id: 'out',
                label: 'Out',
                color: 'var(--color-danger)',
                data: buckets.map((bucket) => ({ date: bucket.period, value: -toValue.convert(bucket[toValue.outField]) }))
            }
        ];
    }, [buckets, denomination]);

    const unit = denomination === 'trx' ? 'TRX' : 'USDT';
    const formatPeriod = useMemo(() => makeFormatPeriod(granularity), [granularity]);

    const actions = (
        <span className={styles.flow_actions}>
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
                <Button variant={denomination === 'trx' ? 'secondary' : 'ghost'} size="xs" onClick={() => setDenomination('trx')}>
                    TRX
                </Button>
                <Button variant={denomination === 'usdt' ? 'secondary' : 'ghost'} size="xs" onClick={() => setDenomination('usdt')}>
                    USDT
                </Button>
            </span>
        </span>
    );

    return (
        <Card padding="md">
            <BarChart
                series={series}
                title="Money in / out"
                actions={actions}
                layout="stacked"
                height={260}
                xAxisFormatter={formatPeriod}
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
