'use client';

/**
 * @fileoverview The activity calendar panel — wraps the reusable CalendarHeatmap
 * in a core Panel. Kept as a thin adapter so the heatmap primitive stays
 * domain-free while this view supplies the section title.
 */

import type { IActivityCalendarBucket } from '@/types';
import { CalendarHeatmap } from '../../../../../features/charts';
import { Panel } from '../../../../../components/ui/Panel';

/**
 * Props for {@link WalletActivityCalendar}.
 */
interface IWalletActivityCalendarProps {
    /** Per-day transaction counts over the recent window. */
    calendar: IActivityCalendarBucket[];
}

/**
 * Render the wallet's recent activity as a contributions-style heatmap.
 *
 * @param props - {@link IWalletActivityCalendarProps}.
 * @returns The activity calendar panel.
 */
export function WalletActivityCalendar({ calendar }: IWalletActivityCalendarProps) {
    return (
        <Panel title="Activity calendar" meta="Transactions per day">
            <CalendarHeatmap data={calendar} emptyLabel="No activity in the recent window." />
        </Panel>
    );
}
