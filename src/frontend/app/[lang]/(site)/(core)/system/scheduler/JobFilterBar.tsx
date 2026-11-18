'use client';

/**
 * @fileoverview The search box and status choice above the /system/scheduler
 * Jobs table.
 *
 * The unscoped table lists every job on the deployment, about fifty, and an
 * operator usually opens it to find the failed ones or one owner's jobs. This
 * row narrows the list in place; the page turns its values into the monitor's
 * `jobFilter` with `buildJobFilter`. It holds no state of its own, so the page
 * keeps the filter while the operator switches tabs and back.
 */

import type { ChangeEvent } from 'react';
import { Input } from '../../../../../../components/ui/Input';
import { SegmentedControl, type ISegmentedControlOption } from '../../../../../../components/ui/SegmentedControl';
import type { JobStatusFilter } from './buildJobFilter';
import styles from './JobFilterBar.module.scss';

/** The status choices, in the order an operator reaches for them. */
const STATUS_OPTIONS: ReadonlyArray<ISegmentedControlOption<JobStatusFilter>> = [
    { id: 'all', label: 'All' },
    { id: 'failed', label: 'Failed' },
    { id: 'running', label: 'Running' },
    { id: 'disabled', label: 'Disabled' }
];

/** Props for the filter row. */
interface IJobFilterBarProps {
    /** The search text, held by the page so it survives a tab switch. */
    query: string;
    /** The selected status choice, held by the page for the same reason. */
    status: JobStatusFilter;
    /** Receives the search text on every keystroke; filtering needs no request, so no debounce. */
    onQueryChange: (query: string) => void;
    /** Receives the status the operator picked. */
    onStatusChange: (status: JobStatusFilter) => void;
}

/**
 * Render the search box and the status choice on one row, wrapping the
 * status choice under the search box when the row is too narrow for both.
 *
 * Neither control has a visible label: the row sits directly above the table
 * it narrows, and the placeholder and the segment names say what each does.
 * Both carry an accessible name for screen readers.
 *
 * @param props - The current search text and status, and the callbacks that
 *        change them, as described on IJobFilterBarProps.
 * @returns The filter row.
 */
export function JobFilterBar({ query, status, onQueryChange, onStatusChange }: IJobFilterBarProps) {
    /**
     * Hand the typed text to the page, which rebuilds the monitor's filter.
     *
     * @param event - The search input's change event.
     */
    const handleQueryChange = (event: ChangeEvent<HTMLInputElement>): void => {
        onQueryChange(event.target.value);
    };

    return (
        <div className={styles.filter_bar}>
            <Input
                type="search"
                value={query}
                onChange={handleQueryChange}
                placeholder="Filter by job name"
                aria-label="Filter jobs by name"
                className={styles.search}
            />
            <SegmentedControl
                label="Job status"
                value={status}
                options={STATUS_OPTIONS}
                onChange={onStatusChange}
            />
        </div>
    );
}
