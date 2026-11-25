'use client';

/**
 * @fileoverview The signed-in body of the `/a/<address>` page.
 *
 * Holds the span selector and shares the chosen span with the sections below
 * it. The sections themselves arrive as children: the server streams each one
 * in as its chain read finishes, so the page shows its first section without
 * waiting for its slowest. Changing the span does not reload the page; each
 * span section refetches itself and updates as soon as its own data arrives.
 */

import { useMemo, useState, type ReactNode } from 'react';
import type { AddressExplorerPeriod } from '@/types';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { AddressExplorerContext, type IAddressExplorerContextValue } from '../../hooks/useAddressExplorer';
import styles from './AddressExplorerView.module.scss';

/** Props for {@link AddressExplorerView}. */
export interface IAddressExplorerViewProps {
    /** The base58 address the page is about. */
    address: string;
    /** The span the server read the streamed sections over. */
    initialPeriod: AddressExplorerPeriod;
    /** The page's sections, each streamed in by the server. */
    children: ReactNode;
}

/**
 * Render the span selector above the page's sections and share the chosen
 * span with them.
 *
 * @param props - {@link IAddressExplorerViewProps}.
 * @returns The signed-in body of the page.
 */
export function AddressExplorerView({ address, initialPeriod, children }: IAddressExplorerViewProps) {
    const { t } = useTranslation();
    const [period, setPeriod] = useState<AddressExplorerPeriod>(initialPeriod);
    // A new object only when a value changes, so the sections re-render for a
    // span change and not for every render of this component.
    const context = useMemo<IAddressExplorerContextValue>(
        () => ({ address, period, initialPeriod }),
        [address, period, initialPeriod]
    );

    const periodOptions = [
        { id: '24h' as const, label: t('addressExplorer.period.24h', '24 hours') },
        { id: '7d' as const, label: t('addressExplorer.period.7d', '7 days') },
        { id: '21d' as const, label: t('addressExplorer.period.21d', '21 days') }
    ];

    return (
        <AddressExplorerContext.Provider value={context}>
            <div className={styles.view}>
                <div className={styles.toolbar}>
                    <SegmentedControl
                        options={periodOptions}
                        value={period}
                        onChange={setPeriod}
                        label={t('addressExplorer.period.label', 'Summary span')}
                    />
                    <span className={styles.hint}>
                        {t('addressExplorer.period.hint', 'Applies to the summary, counterparties, delegations, and permission changes.')}
                    </span>
                </div>
                {children}
            </div>
        </AddressExplorerContext.Provider>
    );
}
