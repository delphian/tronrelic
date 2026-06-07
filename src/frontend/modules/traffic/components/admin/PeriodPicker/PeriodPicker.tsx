/**
 * PeriodPicker Component
 *
 * Shared lookback-window control for the `/system/traffic` dashboards:
 * preset period buttons (24h / 7d / 30d / 90d) plus a custom date range.
 * Extracted from the AnalyticsDashboard so one global picker can govern
 * every tab instead of each section carrying its own — the per-section
 * pickers let admins unknowingly compare a 24h table against a 30d chart.
 *
 * Fully controlled: the parent owns the period and custom-date state and
 * derives the actual query range.
 */

'use client';

import React from 'react';
import { Calendar } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import type { AnalyticsPeriod } from '../../../api';
import styles from './PeriodPicker.module.scss';

/** Preset period options shown as buttons. */
const PERIOD_OPTIONS: { value: AnalyticsPeriod; label: string }[] = [
    { value: '24h', label: '24 Hours' },
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' }
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
 * Render the preset-period buttons and, when "Custom" is active, the
 * native date-range inputs.
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
        <div className={styles.controls} role="group" aria-label="Lookback period">
            {PERIOD_OPTIONS.map(opt => (
                <Button
                    key={opt.value}
                    variant={period === opt.value ? 'primary' : 'secondary'}
                    size="sm"
                    onClick={() => onPeriodChange(opt.value)}
                >
                    {opt.label}
                </Button>
            ))}
            <Button
                variant={period === 'custom' ? 'primary' : 'secondary'}
                size="sm"
                onClick={() => onPeriodChange('custom')}
                aria-label="Custom date range"
            >
                <Calendar size={14} className={styles.controls__icon} />
                Custom
            </Button>
            {period === 'custom' && (
                <div className={styles.date_range}>
                    <input
                        type="date"
                        className={styles.date_input}
                        value={customStart}
                        max={customEnd}
                        onChange={(e) => onCustomStartChange(e.target.value)}
                        aria-label="Start date"
                    />
                    <span className={styles.date_range__separator}>to</span>
                    <input
                        type="date"
                        className={styles.date_input}
                        value={customEnd}
                        min={customStart}
                        max={toDateInputValue(new Date())}
                        onChange={(e) => onCustomEndChange(e.target.value)}
                        aria-label="End date"
                    />
                </div>
            )}
        </div>
    );
}
