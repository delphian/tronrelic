'use client';

/**
 * @fileoverview Monthly inflow vs outflow — an aggregated flow visualization that
 * is an industry-wide gap even on EVM (most tools show a flat list instead of
 * summarizing flow). Because the ledger carries no USD valuation, TRX and USDT
 * cannot share an axis, so a denomination toggle switches between them rather
 * than summing into one misleading total.
 */

import { useMemo, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import type { IWalletFlowBucket } from '@/types';
import { BarChart, type BarChartSeries } from '../../../../../features/charts';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { trxFromSun, usdtFromRaw } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

/** Which denomination the chart currently plots. */
type FlowDenomination = 'trx' | 'usdt';

/** Locale-independent month abbreviations, for hydration-safe axis labels. */
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * Props for {@link WalletFlowChart}.
 */
interface IWalletFlowChartProps {
    /** Per-month inflow/outflow buckets, oldest first. */
    flow: IWalletFlowBucket[];
}

/**
 * Format a month-bucket Date as `MMM YY` using UTC fields and a fixed name table,
 * so the axis label is identical on server and client (no locale/timezone drift).
 *
 * @param date - The bucket's month-start Date (parsed UTC by the chart).
 * @returns The `MMM YY` label.
 */
function formatPeriod(date: Date): string {
    return `${MONTH_NAMES[date.getUTCMonth()]} ${String(date.getUTCFullYear()).slice(2)}`;
}

/**
 * Render monthly inflow/outflow as grouped green/red columns with a TRX⇄USDT
 * denomination toggle in the chart's header.
 *
 * @param props - {@link IWalletFlowChartProps}.
 * @returns The flow chart section.
 */
export function WalletFlowChart({ flow }: IWalletFlowChartProps) {
    const [denomination, setDenomination] = useState<FlowDenomination>('trx');

    // Recompute the two series only when the data or denomination changes; a
    // fresh array identity each render would otherwise re-key the chart need-
    // lessly. "In" and "Out" are grouped side by side (both positive) so the
    // month-over-month comparison reads directly.
    const series = useMemo<BarChartSeries[]>(() => {
        const toValue = denomination === 'trx'
            ? { inField: 'trxInSun' as const, outField: 'trxOutSun' as const, convert: trxFromSun }
            : { inField: 'usdtInRaw' as const, outField: 'usdtOutRaw' as const, convert: usdtFromRaw };
        return [
            {
                id: 'in',
                label: 'In',
                color: 'var(--color-success)',
                data: flow.map((bucket) => ({ date: bucket.period, value: toValue.convert(bucket[toValue.inField]) }))
            },
            {
                id: 'out',
                label: 'Out',
                color: 'var(--color-danger)',
                data: flow.map((bucket) => ({ date: bucket.period, value: toValue.convert(bucket[toValue.outField]) }))
            }
        ];
    }, [flow, denomination]);

    const unit = denomination === 'trx' ? 'TRX' : 'USDT';

    const toggle = (
        <span className={styles.flow_toggle}>
            <Button variant={denomination === 'trx' ? 'secondary' : 'ghost'} size="xs" onClick={() => setDenomination('trx')}>
                TRX
            </Button>
            <Button variant={denomination === 'usdt' ? 'secondary' : 'ghost'} size="xs" onClick={() => setDenomination('usdt')}>
                USDT
            </Button>
        </span>
    );

    return (
        <Card padding="md">
            <BarChart
                series={series}
                title="Money in / out"
                actions={toggle}
                height={260}
                xAxisFormatter={formatPeriod}
                yAxisFormatter={(value) => `${value.toLocaleString(undefined, { maximumFractionDigits: 0 })} ${unit}`}
                emptyLabel={`No ${unit} inflow or outflow recorded.`}
            />
            <p className="text-muted">
                <ArrowLeftRight size={14} aria-hidden /> Inflow and outflow are shown per token — values are not converted to a
                common currency.
            </p>
        </Card>
    );
}
