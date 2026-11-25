'use client';

/**
 * @fileoverview The energy and bandwidth delegations section of the address page.
 *
 * Delegations move no TRX, so they never appear among transfers. Listing them
 * here shows who rents energy to the wallet, or who it rents energy to. Each
 * row names the other party from this wallet's side, so the reader does not
 * have to work out which of delegator and receiver is the page's address.
 */

import type { AddressExplorerSection, IAddressExplorerDelegation, IAddressExplorerDelegations } from '@/types';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Panel } from '../../../../components/ui/Panel';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { TronAddress } from '../../../../components/ui/TronAddress';
import { TronTransactionId } from '../../../../components/ui/TronTransactionId';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { formatAmount } from '../../lib/formatAmount';
import { AddressSectionNotice } from '../AddressSectionNotice';
import styles from '../addressExplorerPanel.module.scss';

/** Props for {@link AddressDelegationsPanel}. */
export interface IAddressDelegationsPanelProps {
    /** The address the page is about, to tell which side of each delegation it is on. */
    address: string;
    /** The delegations section. */
    section: AddressExplorerSection<IAddressExplorerDelegations>;
    /** Reloads the page's sections after a failure a retry can fix. */
    onRetry: () => void;
}

/**
 * The other party of a delegation, seen from the page's address.
 *
 * @param event - The delegation.
 * @param address - The page's address.
 * @returns The other address and whether the page's address delegated it.
 */
function otherParty(event: IAddressExplorerDelegation, address: string): { party: string; outgoing: boolean } {
    const outgoing = event.delegator === address;
    return { party: outgoing ? event.receiver : event.delegator, outgoing };
}

/**
 * Render the delegations section.
 *
 * @param props - {@link IAddressDelegationsPanelProps}.
 * @returns The delegations panel.
 */
export function AddressDelegationsPanel({ address, section, onRetry }: IAddressDelegationsPanelProps) {
    const { t } = useTranslation();
    const baseUnits = t('addressExplorer.baseUnits', 'base units');
    const data = section.status === 'ok' ? section.data : null;
    const meta = data?.truncated ? t('addressExplorer.delegations.truncated', 'The newest {count} in this span', { count: String(data.events.length) }) : undefined;

    return (
        <Panel title={t('addressExplorer.delegations.title', 'Energy and bandwidth delegations')} titleAs="h2" meta={meta}>
            <>
                <AddressSectionNotice section={section} coverageField="blocksComplete" onRetry={onRetry} />
                {data && data.events.length === 0 && (
                    <p className={styles.empty}>{t('addressExplorer.delegations.empty', 'This address made or received no delegations in this span.')}</p>
                )}
                {data && data.events.length > 0 && (
                    <Table variant="compact" stackAt="tablet" flush>
                        <Thead>
                            <Tr>
                                <Th width="shrink">{t('addressExplorer.col.time', 'Time')}</Th>
                                <Th width="shrink">{t('addressExplorer.col.action', 'Action')}</Th>
                                <Th>{t('addressExplorer.col.otherParty', 'Other party')}</Th>
                                <Th numeric>{t('addressExplorer.col.stakedTrx', 'Staked TRX')}</Th>
                                <Th>{t('addressExplorer.col.transaction', 'Transaction')}</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {data.events.map(event => {
                                const { party, outgoing } = otherParty(event, address);
                                const actionLabel = event.action === 'delegate'
                                    ? (outgoing ? t('addressExplorer.delegations.delegatedTo', 'Delegated to') : t('addressExplorer.delegations.receivedFrom', 'Received from'))
                                    : (outgoing ? t('addressExplorer.delegations.reclaimedFrom', 'Reclaimed from') : t('addressExplorer.delegations.reclaimedBy', 'Reclaimed by'));
                                const resource = event.resource === 'ENERGY'
                                    ? t('addressExplorer.resource.energy', 'Energy')
                                    : t('addressExplorer.resource.bandwidth', 'Bandwidth');
                                return (
                                    <Tr key={`${event.txId}:${event.delegator}:${event.receiver}:${event.resource}`}>
                                        <Td><ClientTime date={event.time} format="short" /></Td>
                                        <Td label={t('addressExplorer.col.action', 'Action')}>
                                            <span className={styles.stacked}>
                                                <Badge tone={event.action === 'delegate' ? 'info' : 'neutral'} size="xs">{actionLabel}</Badge>
                                                <span className={styles.secondary}>{resource}</span>
                                            </span>
                                        </Td>
                                        <Td label={t('addressExplorer.col.otherParty', 'Other party')}><TronAddress address={party} /></Td>
                                        <Td numeric label={t('addressExplorer.col.stakedTrx', 'Staked TRX')}>
                                            <span className={`${styles.stacked} ${styles['stacked--end']}`}>
                                                <span>{formatAmount(event.stakedTrx, baseUnits)}</span>
                                                {event.lockPeriod && (
                                                    <span className={styles.secondary}>
                                                        {t('addressExplorer.delegations.lockedFor', 'Locked for {hours} h', { hours: String(event.lockPeriod.approxHours) })}
                                                    </span>
                                                )}
                                            </span>
                                        </Td>
                                        <Td label={t('addressExplorer.col.transaction', 'Transaction')}><TronTransactionId txId={event.txId} /></Td>
                                    </Tr>
                                );
                            })}
                        </Tbody>
                    </Table>
                )}
            </>
        </Panel>
    );
}
