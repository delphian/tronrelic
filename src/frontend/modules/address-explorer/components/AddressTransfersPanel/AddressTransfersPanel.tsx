'use client';

/**
 * @fileoverview The transfers section of the address page.
 *
 * Starts with the newest page the server streamed and grows downward as the
 * reader asks for older transfers, back to the start of the stored history.
 * The span selector does not limit this list: it always reaches the full 21
 * days, a page at a time, which keeps every read small however busy the
 * wallet is, and a span change does not reload it.
 */

import { useCallback, useState } from 'react';
import { mergeAddressExplorerCoverage } from '@/types';
import type {
    AddressExplorerErrorReason,
    AddressExplorerSection,
    IAddressExplorerCoverage,
    IAddressExplorerToken,
    IAddressExplorerTransfer,
    IAddressExplorerTransfers,
    IAddressExplorerTransfersCursor
} from '@/types';
import { Badge } from '../../../../components/ui/Badge';
import { Button } from '../../../../components/ui/Button';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Panel } from '../../../../components/ui/Panel';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { TronAddress } from '../../../../components/ui/TronAddress';
import { TronTransactionId } from '../../../../components/ui/TronTransactionId';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { fetchAddressTransfers } from '../../api/addressExplorer.api';
import { useAddressExplorer } from '../../hooks/useAddressExplorer';
import { sectionTitle } from '../../lib/sectionTitle';
import { AddressSectionNotice } from '../AddressSectionNotice';
import { TokenAmount } from '../TokenAmount';
import styles from '../addressExplorerPanel.module.scss';

/** Props for {@link AddressTransfersPanel}. */
export interface IAddressTransfersPanelProps {
    /** The newest page, streamed by the server. */
    initialSection: AddressExplorerSection<IAddressExplorerTransfers>;
}

/**
 * Everything the list shows, held together so a reload of the newest page
 * replaces all of it at once.
 */
interface ITransferListState {
    /** The newest page, which the section's notice and retry are about. */
    first: AddressExplorerSection<IAddressExplorerTransfers>;
    /** Every row loaded so far, newest first. */
    rows: IAddressExplorerTransfer[];
    /** Token details for every loaded row. */
    tokens: Record<string, IAddressExplorerToken>;
    /** Where older transfers continue, or null at the start of the stored history. */
    next: IAddressExplorerTransfersCursor | null;
    /** The start of the oldest loaded window, for the panel's meta line. */
    oldest: string | null;
    /**
     * Coverage of every page on screen. A gap in an older week hides transfers
     * as badly as one in the newest, so the notice speaks for the whole list.
     */
    coverage: IAddressExplorerCoverage | null;
}

/**
 * A stable key for a transfer row. One transaction can move several tokens,
 * and a wallet paying itself appears in both directions.
 *
 * @param row - The transfer.
 * @param index - The row's position, which separates two legs of one transaction that share every other field.
 * @returns The key.
 */
function rowKey(row: IAddressExplorerTransfer, index: number): string {
    return `${row.txId}:${row.source}:${row.token}:${row.direction}:${index}`;
}

/**
 * Start the list over from a newest page, for the first render and a reload.
 *
 * @param first - The newest page, read or failed.
 * @returns The list showing only that page.
 */
function listFrom(first: AddressExplorerSection<IAddressExplorerTransfers>): ITransferListState {
    const ok = first.status === 'ok' ? first : null;
    return {
        first,
        rows: ok?.data.transfers ?? [],
        tokens: ok?.tokens ?? {},
        next: ok?.data.next ?? null,
        oldest: ok?.window.from ?? null,
        coverage: ok?.coverage ?? null
    };
}

/**
 * Render the transfers section.
 *
 * @param props - {@link IAddressTransfersPanelProps}.
 * @returns The transfers panel.
 */
export function AddressTransfersPanel({ initialSection }: IAddressTransfersPanelProps) {
    const { t } = useTranslation();
    const { address } = useAddressExplorer();
    const [list, setList] = useState<ITransferListState>(() => listFrom(initialSection));
    const [olderError, setOlderError] = useState<AddressExplorerErrorReason | null>(null);
    const [loadingOlder, setLoadingOlder] = useState(false);
    const [reloading, setReloading] = useState(false);
    const { next } = list;

    /**
     * Load the next older page and append it. A failure is shown under the
     * list and keeps the rows already loaded, so the reader can retry.
     */
    const loadOlder = useCallback(async () => {
        if (next) {
            setLoadingOlder(true);
            setOlderError(null);
            try {
                const section = await fetchAddressTransfers(address, next);
                if (section.status === 'ok') {
                    setList(current => ({
                        ...current,
                        rows: [...current.rows, ...section.data.transfers],
                        tokens: { ...current.tokens, ...section.tokens },
                        next: section.data.next,
                        oldest: section.window.from,
                        coverage: current.coverage ? mergeAddressExplorerCoverage(current.coverage, section.coverage) : section.coverage
                    }));
                } else {
                    setOlderError(section.reason);
                }
            } catch {
                setOlderError('failed');
            } finally {
                setLoadingOlder(false);
            }
        }
    }, [address, next]);

    /**
     * Read the newest page again after it failed, and start the list over
     * from it. Only this section reloads; the rest of the page is untouched.
     */
    const reload = useCallback(async () => {
        setReloading(true);
        let first: AddressExplorerSection<IAddressExplorerTransfers>;
        try {
            first = await fetchAddressTransfers(address);
        } catch {
            first = { status: 'error', reason: 'failed' };
        }
        setList(listFrom(first));
        setOlderError(null);
        setReloading(false);
    }, [address]);

    const firstOk = list.first.status === 'ok' ? list.first : null;
    const meta = list.oldest
        ? <>{t('addressExplorer.transfers.meta', 'Newest first, back to')} <ClientTime date={list.oldest} format="short" /></>
        : undefined;
    // The notice describes every page on screen, the same range the meta line names.
    const noticeSection: AddressExplorerSection<IAddressExplorerTransfers> = firstOk && list.coverage
        ? { ...firstOk, coverage: list.coverage }
        : list.first;

    return (
        <Panel title={sectionTitle(t, 'transfers')} titleAs="h2" meta={meta} className={reloading ? styles.loading : undefined}>
            <>
                <AddressSectionNotice section={noticeSection} coverageField="complete" onRetry={() => { void reload(); }} />
                {firstOk && list.rows.length === 0 && (
                    <p className={styles.empty}>
                        {next
                            ? t('addressExplorer.transfers.emptyRecent', 'No transfers in the most recent weeks. Load older to keep looking.')
                            : t('addressExplorer.transfers.empty', 'No transfers are stored for this address.')}
                    </p>
                )}
                {list.rows.length > 0 && (
                    <Table variant="compact" stackAt="tablet">
                        <Thead>
                            <Tr>
                                <Th width="shrink">{t('addressExplorer.col.time', 'Time')}</Th>
                                <Th width="shrink">{t('addressExplorer.col.direction', 'Direction')}</Th>
                                <Th>{t('addressExplorer.col.counterparty', 'Counterparty')}</Th>
                                <Th numeric>{t('addressExplorer.col.amount', 'Amount')}</Th>
                                <Th>{t('addressExplorer.col.transaction', 'Transaction')}</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {list.rows.map((row, index) => (
                                <Tr key={rowKey(row, index)}>
                                    <Td><ClientTime date={row.time} format="short" /></Td>
                                    <Td label={t('addressExplorer.col.direction', 'Direction')}>
                                        <Badge tone={row.direction === 'in' ? 'success' : 'neutral'} size="xs">
                                            {row.direction === 'in' ? t('addressExplorer.direction.in', 'Received') : t('addressExplorer.direction.out', 'Sent')}
                                        </Badge>
                                    </Td>
                                    <Td label={t('addressExplorer.col.counterparty', 'Counterparty')}><TronAddress address={row.counterparty} /></Td>
                                    <Td numeric label={t('addressExplorer.col.amount', 'Amount')}>
                                        <TokenAmount amount={row.amount} tokenKey={row.token} token={list.tokens[row.token]} usd={row.usd} />
                                    </Td>
                                    <Td label={t('addressExplorer.col.transaction', 'Transaction')}><TronTransactionId txId={row.txId} /></Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                )}
                {firstOk && (next || list.rows.length > 0) && (
                    <div className={styles.footer}>
                        {next ? (
                            <Button variant="secondary" loading={loadingOlder} onClick={() => { void loadOlder(); }}>
                                {t('addressExplorer.transfers.loadOlder', 'Load older')}
                            </Button>
                        ) : (
                            <span>{t('addressExplorer.transfers.end', 'This is the start of the stored history, which covers the last 21 days.')}</span>
                        )}
                        {olderError && (
                            <AddressSectionNotice section={{ status: 'error', reason: olderError }} coverageField="complete" />
                        )}
                    </div>
                )}
            </>
        </Panel>
    );
}
