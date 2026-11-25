'use client';

/**
 * @fileoverview The summary section of the address page.
 *
 * Leads with the headline figures for the chosen span, then the address's own
 * tags, any groups of lookalike counterparties (the trace address poisoning
 * leaves), and the breakdown by token and direction.
 */

import type { AddressExplorerSection, IAddressExplorerProfile } from '@/types';
import { AlertTriangle } from 'lucide-react';
import { Badge } from '../../../../components/ui/Badge';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { Panel } from '../../../../components/ui/Panel';
import { StatGrid, StatTile } from '../../../../components/ui/StatTile';
import { Table, Tbody, Td, Th, Thead, Tr } from '../../../../components/ui/Table';
import { TronAddress } from '../../../../components/ui/TronAddress';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { formatCount } from '../../lib/formatCount';
import { AddressSectionNotice } from '../AddressSectionNotice';
import { TokenAmount } from '../TokenAmount';
import { TokenLabel } from '../TokenLabel';
import styles from './AddressSummaryPanel.module.scss';

/** Props for {@link AddressSummaryPanel}. */
export interface IAddressSummaryPanelProps {
    /** The address the page is about, for picking out its own tags. */
    address: string;
    /** The summary section. */
    section: AddressExplorerSection<IAddressExplorerProfile>;
    /** Reloads the page's sections after a failure a retry can fix. */
    onRetry: () => void;
}

/**
 * Render the summary section.
 *
 * @param props - {@link IAddressSummaryPanelProps}.
 * @returns The summary panel.
 */
export function AddressSummaryPanel({ address, section, onRetry }: IAddressSummaryPanelProps) {
    const { t } = useTranslation();
    const profile = section.status === 'ok' ? section.data : null;
    const tags = section.status === 'ok' ? section.addressTags[address] ?? [] : [];

    return (
        <Panel title={t('addressExplorer.summary.title', 'Summary')} titleAs="h2">
            <div className={styles.body}>
                <AddressSectionNotice section={section} coverageField="complete" onRetry={onRetry} />
                {profile && section.status === 'ok' && (
                    <>
                        {/* The small tile's column floor puts two figures on a phone's
                            row; at the medium floor each took a row of its own. */}
                        <StatGrid size="md" minColWidth="var(--stat-tile-col-min-sm)">
                            <StatTile label={t('addressExplorer.summary.transfers', 'Transfers')} value={formatCount(profile.activity.transfers)} />
                            <StatTile label={t('addressExplorer.summary.transactions', 'Transactions')} value={formatCount(profile.activity.transactions)} />
                            <StatTile label={t('addressExplorer.summary.counterparties', 'Counterparties')} value={formatCount(profile.activity.counterparties)} />
                            <StatTile
                                label={t('addressExplorer.summary.lastActivity', 'Last activity')}
                                value={profile.activity.lastAt ? <ClientTime date={profile.activity.lastAt} format="relative" /> : '—'}
                                note={profile.activity.firstAt
                                    ? <>{t('addressExplorer.summary.firstInSpan', 'First in span:')} <ClientTime date={profile.activity.firstAt} format="short" /></>
                                    : undefined}
                            />
                        </StatGrid>

                        {tags.length > 0 && (
                            <div className={styles.tags}>
                                <span className={styles.label}>{t('addressExplorer.summary.tags', 'Tags')}</span>
                                {tags.map(tag => <Badge key={tag} tone="info" size="sm">{tag}</Badge>)}
                            </div>
                        )}

                        {profile.lookalikeGroups.length > 0 && (
                            <div className={styles.lookalikes}>
                                <p className={styles.warning}>
                                    <AlertTriangle size={14} aria-hidden="true" />
                                    {t(
                                        'addressExplorer.summary.lookalikes',
                                        'Possible address poisoning: some counterparties share their first and last characters. Check every character before copying an address from this history.'
                                    )}
                                </p>
                                <ul className={styles.groups}>
                                    {profile.lookalikeGroups.map(group => (
                                        // Shown in full: lookalikes share the very characters
                                        // the chip's truncation keeps, so truncated they look identical.
                                        <li key={group.join(',')} className={styles.group}>
                                            {group.map(member => <TronAddress key={member} address={member} label={member} />)}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        )}

                        {profile.byToken.length > 0 && (
                            <Table variant="compact" stackAt="mobile" flush={!profile.truncated}>
                                <Thead>
                                    <Tr>
                                        <Th>{t('addressExplorer.col.token', 'Token')}</Th>
                                        <Th width="shrink">{t('addressExplorer.col.direction', 'Direction')}</Th>
                                        <Th numeric>{t('addressExplorer.col.transfers', 'Transfers')}</Th>
                                        <Th numeric>{t('addressExplorer.col.zeroValue', 'Zero value')}</Th>
                                        <Th numeric>{t('addressExplorer.col.total', 'Total')}</Th>
                                        <Th numeric>{t('addressExplorer.col.counterparties', 'Counterparties')}</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {profile.byToken.map(row => (
                                        <Tr key={`${row.token}:${row.direction}`}>
                                            <Td><TokenLabel tokenKey={row.token} token={section.tokens[row.token]} /></Td>
                                            <Td label={t('addressExplorer.col.direction', 'Direction')}>
                                                <Badge tone={row.direction === 'in' ? 'success' : 'neutral'} size="xs">
                                                    {row.direction === 'in' ? t('addressExplorer.direction.in', 'Received') : t('addressExplorer.direction.out', 'Sent')}
                                                </Badge>
                                            </Td>
                                            <Td numeric label={t('addressExplorer.col.transfers', 'Transfers')}>{formatCount(row.transfers)}</Td>
                                            <Td numeric label={t('addressExplorer.col.zeroValue', 'Zero value')}>{formatCount(row.zeroValueTransfers)}</Td>
                                            <Td numeric label={t('addressExplorer.col.total', 'Total')}><TokenAmount amount={row.total} usd={row.usd} /></Td>
                                            <Td numeric label={t('addressExplorer.col.counterparties', 'Counterparties')}>{formatCount(row.counterparties)}</Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        )}
                        {profile.truncated && (
                            <p className={styles.note}>{t('addressExplorer.summary.truncated', 'Only the busiest tokens are listed.')}</p>
                        )}
                    </>
                )}
            </div>
        </Panel>
    );
}
