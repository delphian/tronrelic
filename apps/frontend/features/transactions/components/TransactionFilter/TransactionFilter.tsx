'use client';

import { useMemo } from 'react';
import type { TronTransactionType } from '@tronrelic/shared';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { Card } from '../../../../components/ui/Card';
import { cn } from '../../../../lib/cn';
import styles from './TransactionFilter.module.css';

/**
 * Filter criteria for transaction queries.
 */
export interface TransactionFilterValue {
    /** Transaction type filter (or 'all' for no filtering) */
    type?: TronTransactionType | 'all';
    /** Minimum TRX amount threshold */
    minAmountTRX?: number;
    /** Search text for memo or address matching */
    search?: string;
    /** Start date for date range filter (ISO format) */
    startDate?: string;
    /** End date for date range filter (ISO format) */
    endDate?: string;
}

/**
 * Properties for the TransactionFilter component.
 */
interface TransactionFilterProps {
    /** Current filter values */
    value: TransactionFilterValue;
    /** Callback when filter values change */
    onChange: (next: TransactionFilterValue) => void;
    /** Optional custom list of transaction types to show */
    availableTypes?: TronTransactionType[];
    /** Callback when reset button is clicked */
    onReset?: () => void;
}

/**
 * Default transaction types shown in the filter dropdown.
 * Covers the most common TRON blockchain operations.
 */
const DEFAULT_TYPES: TronTransactionType[] = [
    'TransferContract',
    'TransferAssetContract',
    'TriggerSmartContract',
    'DelegateResourceContract',
    'UnDelegateResourceContract',
    'FreezeBalanceContract',
    'UnfreezeBalanceContract'
];

/**
 * TransactionFilter - Multi-criteria filter interface for transaction queries
 *
 * Provides filtering controls for transaction lists with:
 * - **Transaction type** - Dropdown with common contract types
 * - **Minimum amount** - Numeric threshold for TRX value
 * - **Search** - Text search for memos or addresses
 * - **Date range** - Start/end date pickers for temporal filtering
 * - **Reset** - Clears all filters at once
 *
 * The component uses controlled inputs, meaning all state is managed by the parent
 * component. Changes are propagated immediately via the onChange callback.
 *
 * Filter values are optional - undefined values mean "no filter applied" for that
 * criterion. The parent component is responsible for applying these filters to the
 * transaction dataset.
 *
 * The component uses a responsive grid that adapts to available space, ensuring
 * usable layouts on mobile, tablet, and desktop screens.
 *
 * @param props - Component properties with filter values and callbacks
 * @returns A card containing filter controls in a responsive grid
 */
export function TransactionFilter({ value, onChange, availableTypes, onReset }: TransactionFilterProps) {
    /**
     * Determines which transaction types to show in the dropdown.
     * Uses availableTypes if provided, otherwise falls back to defaults.
     * Memoized to avoid recalculation on every render.
     */
    const types = useMemo(() => availableTypes ?? DEFAULT_TYPES, [availableTypes]);

    /**
     * Updates filter values with a partial object, merging with existing values.
     *
     * This helper avoids repetition in each input's onChange handler.
     * Undefined values in the partial remove that filter criterion.
     *
     * @param partial - Partial filter values to merge with current state
     */
    const update = (partial: Partial<TransactionFilterValue>) => {
        onChange({
            ...value,
            ...partial
        });
    };

    return (
        <Card tone="muted" padding="md">
            <div className={styles.filter_grid}>
                <label className={styles.field}>
                    <span className={styles.field__label}>Transaction type</span>
                    <select
                        className="input input--ghost"
                        value={value.type ?? 'all'}
                        onChange={event => update({ type: event.target.value as TransactionFilterValue['type'] })}
                    >
                        <option value="all">All types</option>
                        {types.map(type => (
                            <option key={type} value={type}>{formatType(type)}</option>
                        ))}
                    </select>
                </label>

                <label className={styles.field}>
                    <span className={styles.field__label}>Minimum amount (TRX)</span>
                    <Input
                        type="number"
                        min="0"
                        value={value.minAmountTRX?.toString() ?? ''}
                        onChange={event => update({ minAmountTRX: event.target.value ? Number(event.target.value) : undefined })}
                    />
                </label>

                <label className={styles.field}>
                    <span className={styles.field__label}>Search memo or address</span>
                    <Input
                        placeholder="Search"
                        value={value.search ?? ''}
                        onChange={event => update({ search: event.target.value || undefined })}
                    />
                </label>

                <label className={styles.field}>
                    <span className={styles.field__label}>Start date</span>
                    <Input
                        type="date"
                        value={value.startDate ?? ''}
                        onChange={event => update({ startDate: event.target.value || undefined })}
                    />
                </label>

                <label className={styles.field}>
                    <span className={styles.field__label}>End date</span>
                    <Input
                        type="date"
                        value={value.endDate ?? ''}
                        onChange={event => update({ endDate: event.target.value || undefined })}
                    />
                </label>

                <div className={cn(styles.field, styles['field--actions'])}>
                    <span className={styles.field__label}>&nbsp;</span>
                    <Button variant="ghost" size="sm" onClick={onReset ?? (() => onChange({}))}>
                        Reset filters
                    </Button>
                </div>
            </div>
        </Card>
    );
}

/**
 * Formats transaction type for human-readable display.
 *
 * Transforms contract type names from camelCase to spaced format:
 * - "TransferContract" → "Transfer"
 * - "DelegateResourceContract" → "Delegate Resource"
 *
 * The "Contract" suffix is removed as it's implied for all transaction types.
 *
 * @param type - Raw transaction type from TronTransactionType enum
 * @returns Formatted transaction type string
 */
function formatType(type: TronTransactionType) {
    return type.replace(/([A-Z])/g, ' $1').replace(/Contract/, '').trim();
}
