'use client';

/**
 * @fileoverview Top-counterparties panel — the consumer-friendly stand-in for a
 * force-directed address graph. A ranked table answers "who does this wallet deal
 * with most" at a fraction of the build and render cost of an interactive graph,
 * and stays legible on busy and quiet wallets alike.
 */

import { Users } from 'lucide-react';
import type { IWalletCounterparty } from '@/types';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { AddressDisplay, SectionHeader } from './WalletDetailPrimitives';
import { formatCount, formatTrxFromSun } from '../../../lib/walletFormat';
import styles from './WalletDetail.module.scss';

/**
 * Props for {@link WalletCounterparties}.
 */
interface IWalletCounterpartiesProps {
    /** Top counterparties for the wallet, most-frequent first. */
    counterparties: IWalletCounterparty[];
    /** Address → human-friendly label map resolved by the backend (misses omitted). */
    labels?: Record<string, string>;
}

/**
 * Render the wallet's most-frequent counterparties as a ranked table.
 *
 * @param props - {@link IWalletCounterpartiesProps}.
 * @returns The counterparties section.
 */
export function WalletCounterparties({ counterparties, labels }: IWalletCounterpartiesProps) {
    return (
        <div>
            <SectionHeader icon={<Users size={16} aria-hidden />} title="Top counterparties" />
            {counterparties.length === 0 ? (
                <p className="text-muted">No counterparties recorded yet.</p>
            ) : (
                <Table variant="compact">
                    <Thead>
                        <Tr>
                            <Th width="expand">Address</Th>
                            <Th width="shrink">Txns</Th>
                            <Th width="shrink">TRX sent</Th>
                            <Th width="shrink">TRX received</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {counterparties.map((counterparty) => (
                            <Tr key={counterparty.address}>
                                <Td>
                                    <AddressDisplay
                                        address={counterparty.address}
                                        label={labels?.[counterparty.address]}
                                    />
                                </Td>
                                <Td className={styles.counterparty_nowrap}>{formatCount(counterparty.txCount)}</Td>
                                <Td className={styles.counterparty_nowrap} muted>{formatTrxFromSun(counterparty.trxSentSun)}</Td>
                                <Td className={styles.counterparty_nowrap} muted>{formatTrxFromSun(counterparty.trxReceivedSun)}</Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            )}
        </div>
    );
}
