/**
 * PeriodPicker Component
 *
 * Shared lookback-window control for the `/system/traffic` dashboards: a
 * `<SegmentedControl>` carrying the presets (24h / 7d / 30d / 90d) and Custom,
 * plus the date-range inputs Custom reveals.
 * Extracted from the AnalyticsDashboard so one global picker can govern
 * every tab instead of each section carrying its own — the per-section
 * pickers let admins unknowingly compare a 24h table against a 30d chart.
 *
 * Fully controlled: the parent owns the period and custom-date state and
 * derives the actual query range.
 */

'use client';

import React from 'react';
import type { ReactNode } from 'react';
import { Calendar } from 'lucide-react';
import { SegmentedControl } from '../../../../../components/ui/SegmentedControl';
import { Input } from '../../../../../components/ui/Input';
import type { AnalyticsPeriod } from '../../../api';
import styles from './PeriodPicker.module.scss';

/**
 * Segments shown in the picker. `custom` rides in the same control rather than
 * sitting beside it as a separate button, so the five choices read as one
 * mutually-exclusive group — which is what they are — and only the date inputs
 * appear conditionally.
 */
const PERIOD_OPTIONS: ReadonlyArray<{ id: AnalyticsPeriod; label: ReactNode; ariaLabel?: string }> = [
    { id: '24h', label: '24 Hours' },
    { id: '7d', label: '7 Days' },
    { id: '30d', label: '30 Days' },
    { id: '90d', label: '90 Days' },
    {
        id: 'custom',
        label: (
            <>
                <Calendar size={14} className={styles.controls__icon} aria-hidden="true" />
                Custom
            </>
        ),
        ariaLabel: 'Custom date range'
    }
];

/**
 * Format a Date as a YYYY-MM-DD string for native date inputs.
 *
 * @param date - Date to format
 * @returns ISO date string without time component
 */
export function toDateInputValue(date: Date): string {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
}

interface IPeriodPickerProps {
    /** Currently selected period. */
    period: AnalyticsPeriod;
    /** Change handler for preset/custom selection. */
    onPeriodChange(period: AnalyticsPeriod): void;
    /** Custom range start, YYYY-MM-DD local. */
    customStart: string;
    /** Custom range end, YYYY-MM-DD local. */
    customEnd: string;
    /** Change handler for the custom start date. */
    onCustomStartChange(value: string): void;
    /** Change handler for the custom end date. */
    onCustomEndChange(value: string): void;
}

/**
 * Render the period segments and, when "Custom" is active, the native
 * date-range inputs.
 *
 * @param props - Controlled picker state and change handlers.
 * @returns The period picker control group.
 */
export function PeriodPicker({
    period,
    onPeriodChange,
    customStart,
    customEnd,
    onCustomStartChange,
    onCustomEndChange
}: IPeriodPickerProps) {
    return (
        <div className={styles.controls}>
            <SegmentedControl
                label="Lookback period"
                value={period}
                options={PERIOD_OPTIONS}
                onChange={onPeriodChange}
            />
            {period === 'custom' && (
                <div className={styles.date_range}>
                    <Input
                        type="date"
                        size="sm"
                        className={styles.date_input}
                        value={customStart}
                        max={customEnd}
                        // Ignore empty clears — Custom mode must always carry a
                        // real range, or the backend silently serves its default
                        // window while the UI still claims custom dates.
                        onChange={(e) => { if (e.target.value) onCustomStartChange(e.target.value); }}
                        aria-label="Start date"
                    />
                    <span className={styles.date_range__separator}>to</span>
                    <Input
                        type="date"
                        size="sm"
                        className={styles.date_input}
                        value={customEnd}
                        min={customStart}
                        max={toDateInputValue(new Date())}
                        onChange={(e) => { if (e.target.value) onCustomEndChange(e.target.value); }}
                        aria-label="End date"
                    />
                </div>
            )}
        </div>
    );
}
