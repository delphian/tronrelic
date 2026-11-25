'use client';

/**
 * @fileoverview The permission changes section of the address page.
 *
 * A TRON account can hand control to other keys. Each row says who controls
 * the account after the change and lists any outside keys, because a
 * transferred owner permission is how the common TRON takeover scam works;
 * exchanges and multisig wallets set the same thing up on purpose, so it is
 * shown as a warning rather than a verdict.
 */

import type { AddressExplorerOwnerControl, AddressExplorerSection, IAddressExplorerPermissions } from '@/types';
import type { BadgeTone } from '../../../../components/ui/Badge';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Panel } from '../../../../components/ui/Panel';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { TronAddress } from '../../../../components/ui/TronAddress';
import { TronTransactionId } from '../../../../components/ui/TronTransactionId';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { AddressSectionNotice } from '../AddressSectionNotice';
import styles from '../addressExplorerPanel.module.scss';

/** Props for {@link AddressPermissionsPanel}. */
export interface IAddressPermissionsPanelProps {
    /** The permission changes section. */
    section: AddressExplorerSection<IAddressExplorerPermissions>;
    /** Reloads the page's sections after a failure a retry can fix. */
    onRetry: () => void;
}

/** The badge tone for each kind of owner control; a transfer is the one that warns. */
const CONTROL_TONES: Record<AddressExplorerOwnerControl, BadgeTone> = {
    'self-controlled': 'success',
    'shared-owner-control': 'warning',
    'owner-control-transferred': 'danger',
    unknown: 'neutral'
};

/**
 * Render the permission changes section.
 *
 * @param props - {@link IAddressPermissionsPanelProps}.
 * @returns The permission changes panel.
 */
export function AddressPermissionsPanel({ section, onRetry }: IAddressPermissionsPanelProps) {
    const { t } = useTranslation();
    const data = section.status === 'ok' ? section.data : null;
    const controlLabels: Record<AddressExplorerOwnerControl, string> = {
        'self-controlled': t('addressExplorer.permissions.self', 'Own key in control'),
        'shared-owner-control': t('addressExplorer.permissions.shared', 'Shared control'),
        'owner-control-transferred': t('addressExplorer.permissions.transferred', 'Control transferred'),
        unknown: t('addressExplorer.permissions.unknown', 'Unknown')
    };
    const meta = data?.truncated ? t('addressExplorer.permissions.truncated', 'The newest {count} in this span', { count: String(data.updates.length) }) : undefined;

    return (
        <Panel title={t('addressExplorer.permissions.title', 'Permission changes')} titleAs="h2" meta={meta}>
            <>
                <AddressSectionNotice section={section} coverageField="blocksComplete" onRetry={onRetry} />
                {data && data.updates.length === 0 && (
                    <p className={styles.empty}>{t('addressExplorer.permissions.empty', 'This address did not change its permissions in this span.')}</p>
                )}
                {data && data.updates.length > 0 && (
                    <Table variant="compact" stackAt="mobile" flush>
                        <Thead>
                            <Tr>
                                <Th width="shrink">{t('addressExplorer.col.time', 'Time')}</Th>
                                <Th width="shrink">{t('addressExplorer.col.control', 'Control')}</Th>
                                <Th>{t('addressExplorer.col.outsideKeys', 'Outside keys')}</Th>
                                <Th>{t('addressExplorer.col.transaction', 'Transaction')}</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {data.updates.map(update => (
                                <Tr key={update.txId}>
                                    <Td><ClientTime date={update.time} format="short" /></Td>
                                    <Td label={t('addressExplorer.col.control', 'Control')}>
                                        <Badge tone={CONTROL_TONES[update.ownerControl]} size="xs">{controlLabels[update.ownerControl]}</Badge>
                                    </Td>
                                    <Td label={t('addressExplorer.col.outsideKeys', 'Outside keys')}>
                                        {update.outsideKeys.length > 0
                                            ? <span className={styles.chips}>{update.outsideKeys.map(key => <TronAddress key={key} address={key} />)}</span>
                                            : t('addressExplorer.permissions.noOutsideKeys', 'None')}
                                    </Td>
                                    <Td label={t('addressExplorer.col.transaction', 'Transaction')}><TronTransactionId txId={update.txId} /></Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                )}
            </>
        </Panel>
    );
}
