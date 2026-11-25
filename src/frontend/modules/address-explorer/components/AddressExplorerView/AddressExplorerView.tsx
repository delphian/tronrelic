'use client';

/**
 * @fileoverview The signed-in body of the `/a/<address>` page.
 *
 * Renders the overview the server fetched, so the page arrives with its
 * content and no loading state. Changing the span refetches the overview in
 * the browser; while it loads, the current sections stay on screen, dimmed,
 * so the page does not jump. When the server could not fetch the overview at
 * all, the view shows one retry panel instead of five empty sections.
 */

import { useCallback, useState } from 'react';
import type { AddressExplorerPeriod, IAddressExplorerOverview } from '@/types';
import { Button } from '../../../../components/ui/Button';
import { Panel } from '../../../../components/ui/Panel';
import { SegmentedControl } from '../../../../components/ui/SegmentedControl';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { fetchAddressOverview } from '../../api/addressExplorer.api';
import { AddressCounterpartiesPanel } from '../AddressCounterpartiesPanel';
import { AddressDelegationsPanel } from '../AddressDelegationsPanel';
import { AddressPermissionsPanel } from '../AddressPermissionsPanel';
import { AddressSummaryPanel } from '../AddressSummaryPanel';
import { AddressTransfersPanel } from '../AddressTransfersPanel';
import styles from './AddressExplorerView.module.scss';

/** Props for {@link AddressExplorerView}. */
export interface IAddressExplorerViewProps {
    /** The base58 address the page is about. */
    address: string;
    /** The overview the server fetched, or null when that request failed. */
    initialOverview: IAddressExplorerOverview | null;
}

/** The span shown when the server sent no overview to take it from. */
const DEFAULT_PERIOD: AddressExplorerPeriod = '7d';

/**
 * Render the address page's sections with the span selector above them.
 *
 * @param props - {@link IAddressExplorerViewProps}.
 * @returns The signed-in body of the page.
 */
export function AddressExplorerView({ address, initialOverview }: IAddressExplorerViewProps) {
    const { t } = useTranslation();
    const [overview, setOverview] = useState<IAddressExplorerOverview | null>(initialOverview);
    const [period, setPeriod] = useState<AddressExplorerPeriod>(initialOverview?.period ?? DEFAULT_PERIOD);
    const [loading, setLoading] = useState(false);
    const [loadFailed, setLoadFailed] = useState(initialOverview === null);
    // Bumped on every successful load, so the transfers list restarts from the
    // newest page the new overview carries instead of keeping older pages.
    const [version, setVersion] = useState(0);

    /**
     * Fetch the overview for a span and show it. A failure keeps whatever is
     * on screen and offers a retry.
     *
     * @param nextPeriod - The span to load.
     */
    const load = useCallback(async (nextPeriod: AddressExplorerPeriod) => {
        setPeriod(nextPeriod);
        setLoading(true);
        try {
            const next = await fetchAddressOverview(address, nextPeriod);
            setOverview(next);
            setVersion(current => current + 1);
            setLoadFailed(false);
        } catch {
            setLoadFailed(true);
        } finally {
            setLoading(false);
        }
    }, [address]);

    /** Reload the current span, for a section's retry button. */
    const retry = useCallback(() => {
        void load(period);
    }, [load, period]);

    const periodOptions = [
        { id: '24h' as const, label: t('addressExplorer.period.24h', '24 hours') },
        { id: '7d' as const, label: t('addressExplorer.period.7d', '7 days') },
        { id: '21d' as const, label: t('addressExplorer.period.21d', '21 days') }
    ];

    return (
        <div className={styles.view}>
            <div className={styles.toolbar}>
                <SegmentedControl
                    options={periodOptions}
                    value={period}
                    onChange={(id) => { void load(id); }}
                    label={t('addressExplorer.period.label', 'Summary span')}
                    disabled={loading}
                />
                <span className={styles.hint}>
                    {t('addressExplorer.period.hint', 'Applies to the summary, counterparties, delegations, and permission changes.')}
                </span>
            </div>

            {loadFailed && (
                <Panel title={t('addressExplorer.loadFailed.title', 'Activity could not be loaded')} titleAs="h2">
                    <div className={styles.failed}>
                        <p className={styles.failed_text}>
                            {t('addressExplorer.loadFailed.body', 'The request for this address\'s activity failed. Your connection or our server may be having trouble.')}
                        </p>
                        <Button variant="secondary" loading={loading} onClick={retry}>
                            {t('addressExplorer.error.retry', 'Retry')}
                        </Button>
                    </div>
                </Panel>
            )}

            {overview && (
                <div className={loading ? `${styles.sections} ${styles['sections--loading']}` : styles.sections} aria-busy={loading}>
                    <AddressSummaryPanel address={address} section={overview.profile} onRetry={retry} />
                    <AddressCounterpartiesPanel section={overview.counterparties} onRetry={retry} />
                    <AddressTransfersPanel key={version} address={address} initialSection={overview.transfers} onRetry={retry} />
                    <AddressDelegationsPanel address={address} section={overview.delegations} onRetry={retry} />
                    <AddressPermissionsPanel section={overview.permissions} onRetry={retry} />
                </div>
            )}
        </div>
    );
}
