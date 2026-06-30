'use client';

/**
 * @fileoverview The activity calendar panel — wraps the reusable CalendarHeatmap
 * in the detail view's section chrome. Kept as a thin adapter so the heatmap
 * primitive stays domain-free while this view supplies the section title and icon.
 */

import { CalendarDays } from 'lucide-react';
import type { IActivityCalendarBucket } from '@/types';
import { CalendarHeatmap } from '../../../../../features/charts';
import { WalletDetailSection } from './WalletDetailPrimitives';

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
 * @returns The activity calendar section.
 */
export function WalletActivityCalendar({ calendar }: IWalletActivityCalendarProps) {
    return (
        <WalletDetailSection icon={<CalendarDays size={16} aria-hidden />} title="Activity calendar">
            <CalendarHeatmap data={calendar} emptyLabel="No activity in the recent window." />
        </WalletDetailSection>
    );
}
