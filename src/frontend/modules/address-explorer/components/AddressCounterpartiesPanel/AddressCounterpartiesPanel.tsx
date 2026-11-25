'use client';

/**
 * @fileoverview The counterparties section of the address page.
 *
 * Lists the addresses the wallet deals with most often over the chosen span,
 * one row per counterparty, token, and direction, so a reader sees who the
 * wallet trades with before reading individual transfers.
 */

import type { AddressExplorerSection, IAddressExplorerCounterparties } from '@/types';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Panel } from '../../../../components/ui/Panel';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { TronAddress } from '../../../../components/ui/TronAddress';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { useSpanSection } from '../../hooks/useSpanSection';
import { formatCount } from '../../lib/formatCount';
import { sectionTitle } from '../../lib/sectionTitle';
import { AddressSectionNotice } from '../AddressSectionNotice';
import { TokenAmount } from '../TokenAmount';
import styles from '../addressExplorerPanel.module.scss';

/** Props for {@link AddressCounterpartiesPanel}. */
export interface IAddressCounterpartiesPanelProps {
    /** The counterparties section the server streamed, read over the page's initial span. */
    initialSection: AddressExplorerSection<IAddressExplorerCounterparties>;
}

/**
 * Render the counterparties section, refetching it when the chosen span changes.
 *
 * @param props - {@link IAddressCounterpartiesPanelProps}.
 * @returns The counterparties panel.
 */
export function AddressCounterpartiesPanel({ initialSection }: IAddressCounterpartiesPanelProps) {
    const { t } = useTranslation();
    const { section, loading, retry } = useSpanSection('counterparties', initialSection);
    const data = section.status === 'ok' ? section.data : null;
    const meta = data && data.counterparties.length > 0
        ? t('addressExplorer.counterparties.meta', 'Top {shown} of {total} by number of transfers', {
            shown: formatCount(data.counterparties.length),
            total: formatCount(data.totalGroups)
        })
        : undefined;

    return (
        <Panel title={sectionTitle(t, 'counterparties')} titleAs="h2" meta={meta} className={loading ? styles.loading : undefined}>
            <>
                <AddressSectionNotice section={section} coverageField="complete" onRetry={retry} />
                {data && section.status === 'ok' && data.counterparties.length === 0 && (
                    <p className={styles.empty}>{t('addressExplorer.counterparties.empty', 'No value moved to or from this address in this span.')}</p>
                )}
                {data && section.status === 'ok' && data.counterparties.length > 0 && (
                    <Table variant="compact" stackAt="tablet" flush>
                        <Thead>
                            <Tr>
                                <Th>{t('addressExplorer.col.counterparty', 'Counterparty')}</Th>
                                <Th width="shrink">{t('addressExplorer.col.direction', 'Direction')}</Th>
                                <Th numeric>{t('addressExplorer.col.transfers', 'Transfers')}</Th>
                                <Th numeric>{t('addressExplorer.col.total', 'Total')}</Th>
                                <Th width="shrink">{t('addressExplorer.col.lastSeen', 'Last seen')}</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {data.counterparties.map(row => (
                                <Tr key={`${row.counterparty}:${row.token}:${row.direction}`}>
                                    <Td><TronAddress address={row.counterparty} /></Td>
                                    <Td label={t('addressExplorer.col.direction', 'Direction')}>
                                        <Badge tone={row.direction === 'in' ? 'success' : 'neutral'} size="xs">
                                            {row.direction === 'in' ? t('addressExplorer.direction.from', 'From') : t('addressExplorer.direction.to', 'To')}
                                        </Badge>
                                    </Td>
                                    <Td numeric label={t('addressExplorer.col.transfers', 'Transfers')}>{formatCount(row.transfers)}</Td>
                                    <Td numeric label={t('addressExplorer.col.total', 'Total')}>
                                        <TokenAmount amount={row.total} tokenKey={row.token} token={section.tokens[row.token]} usd={row.usd} />
                                    </Td>
                                    <Td label={t('addressExplorer.col.lastSeen', 'Last seen')}><ClientTime date={row.lastAt} format="relative" /></Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                )}
            </>
        </Panel>
    );
}
