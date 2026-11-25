'use client';

/**
 * @fileoverview The transfers section of the address page.
 *
 * Starts with the newest page the server rendered and grows downward as the
 * reader asks for older transfers, back to the start of the stored history.
 * The span selector does not limit this list: it always reaches the full 21
 * days, a page at a time, which keeps every read small however busy the
 * wallet is.
 */

import { useCallback, useState } from 'react';
import type {
    AddressExplorerErrorReason,
    AddressExplorerSection,
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
import { AddressSectionNotice } from '../AddressSectionNotice';
import { TokenAmount } from '../TokenAmount';
import styles from '../addressExplorerPanel.module.scss';

/** Props for {@link AddressTransfersPanel}. */
export interface IAddressTransfersPanelProps {
    /** The address the page is about. */
    address: string;
    /** The newest page, rendered on the server. */
    initialSection: AddressExplorerSection<IAddressExplorerTransfers>;
    /** Reloads the page's sections after the first page failed. */
    onRetry: () => void;
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
 * Render the transfers section.
 *
 * @param props - {@link IAddressTransfersPanelProps}.
 * @returns The transfers panel.
 */
export function AddressTransfersPanel({ address, initialSection, onRetry }: IAddressTransfersPanelProps) {
    const { t } = useTranslation();
    const initialOk = initialSection.status === 'ok' ? initialSection : null;
    const [rows, setRows] = useState<IAddressExplorerTransfer[]>(initialOk?.data.transfers ?? []);
    const [tokens, setTokens] = useState<Record<string, IAddressExplorerToken>>(initialOk?.tokens ?? {});
    const [next, setNext] = useState<IAddressExplorerTransfersCursor | null>(initialOk?.data.next ?? null);
    const [oldest, setOldest] = useState<string | null>(initialOk?.window.from ?? null);
    const [olderError, setOlderError] = useState<AddressExplorerErrorReason | null>(null);
    const [loading, setLoading] = useState(false);

    /**
     * Load the next older page and append it. A failure is shown under the
     * list and keeps the rows already loaded, so the reader can retry.
     */
    const loadOlder = useCallback(async () => {
        if (next) {
            setLoading(true);
            setOlderError(null);
            try {
                const section = await fetchAddressTransfers(address, next);
                if (section.status === 'ok') {
                    setRows(current => [...current, ...section.data.transfers]);
                    setTokens(current => ({ ...current, ...section.tokens }));
                    setNext(section.data.next);
                    setOldest(section.window.from);
                } else {
                    setOlderError(section.reason);
                }
            } catch {
                setOlderError('failed');
            } finally {
                setLoading(false);
            }
        }
    }, [address, next]);

    const meta = oldest
        ? <>{t('addressExplorer.transfers.meta', 'Newest first, back to')} <ClientTime date={oldest} format="short" /></>
        : undefined;

    return (
        <Panel title={t('addressExplorer.transfers.title', 'Transfers')} titleAs="h2" meta={meta}>
            <>
                <AddressSectionNotice section={initialSection} coverageField="complete" onRetry={onRetry} />
                {initialOk && rows.length === 0 && (
                    <p className={styles.empty}>
                        {next
                            ? t('addressExplorer.transfers.emptyRecent', 'No transfers in the most recent weeks. Load older to keep looking.')
                            : t('addressExplorer.transfers.empty', 'No transfers are stored for this address.')}
                    </p>
                )}
                {rows.length > 0 && (
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
                            {rows.map((row, index) => (
                                <Tr key={rowKey(row, index)}>
                                    <Td><ClientTime date={row.time} format="short" /></Td>
                                    <Td label={t('addressExplorer.col.direction', 'Direction')}>
                                        <Badge tone={row.direction === 'in' ? 'success' : 'neutral'} size="xs">
                                            {row.direction === 'in' ? t('addressExplorer.direction.in', 'Received') : t('addressExplorer.direction.out', 'Sent')}
                                        </Badge>
                                    </Td>
                                    <Td label={t('addressExplorer.col.counterparty', 'Counterparty')}><TronAddress address={row.counterparty} /></Td>
                                    <Td numeric label={t('addressExplorer.col.amount', 'Amount')}>
                                        <TokenAmount amount={row.amount} tokenKey={row.token} token={tokens[row.token]} usd={row.usd} />
                                    </Td>
                                    <Td label={t('addressExplorer.col.transaction', 'Transaction')}><TronTransactionId txId={row.txId} /></Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                )}
                {initialOk && (next || rows.length > 0) && (
                    <div className={styles.footer}>
                        {next ? (
                            <Button variant="secondary" loading={loading} onClick={() => { void loadOlder(); }}>
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
