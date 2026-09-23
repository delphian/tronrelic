'use client';

/**
 * @fileoverview The newest prepared blocks, one row each.
 *
 * Aggregates say how the pipeline is doing on average; this table shows what
 * happened to each recent block, which is what an operator reads when an
 * aggregate looks wrong: whether its receipts arrived, how many events and
 * token transfers were decoded, how long it took, and whether it went through
 * the buffer or was written straight away as catch-up work.
 */

import type { IPipelineStatus } from '@/types';
import { Card } from '../../../../../../components/ui/Card';
import { Stack } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { formatMs, formatNumber, RECEIPT_OUTCOME_DISPLAY } from './pipeline-format';
import styles from './PipelineTab.module.scss';

/** Inputs for the recent blocks table. */
interface IRecentBlocksTableProps {
    /** The pipeline payload. */
    pipeline: IPipelineStatus;
}

/**
 * Render the recent blocks table.
 *
 * @param props - The payload.
 * @returns The card.
 */
export function RecentBlocksTable({ pipeline }: IRecentBlocksTableProps) {
    const { recentBlocks } = pipeline;

    return (
        <Card padding="sm" noBackgroundImage>
            <Stack gap="sm">
                <header className={styles.card_header}>
                    <h3 className={styles.card_title}>Recent blocks</h3>
                    <span className={styles.card_note}>Newest first. A block with no commit time is still in the buffer.</span>
                </header>

                {recentBlocks.length === 0 ? (
                    <p className="text-muted">No blocks prepared since the backend started.</p>
                ) : (
                    <Table variant="compact" flush>
                        <Thead>
                            <Tr>
                                <Th scope="col" numeric>Block</Th>
                                <Th scope="col">Produced</Th>
                                <Th scope="col" numeric>Txs</Th>
                                <Th scope="col">Receipts</Th>
                                <Th scope="col" numeric>Events</Th>
                                <Th scope="col" numeric>Transfers</Th>
                                <Th scope="col" numeric>Prepare</Th>
                                <Th scope="col" numeric>Commit</Th>
                                <Th scope="col">Path</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {recentBlocks.map(block => {
                                const receipt = RECEIPT_OUTCOME_DISPLAY[block.receiptOutcome];
                                return (
                                    <Tr key={`${block.blockNumber}-${block.preparedAt}`}>
                                        <Td numeric>{formatNumber(block.blockNumber)}</Td>
                                        <Td><ClientTime date={block.blockTimestamp} format="relative" /></Td>
                                        <Td numeric>{formatNumber(block.transactionCount)}</Td>
                                        <Td>
                                            <span title={receipt.hint}>
                                                <Badge tone={receipt.tone} size="xs">{receipt.label}</Badge>
                                            </span>
                                        </Td>
                                        <Td numeric>{formatNumber(block.eventCount)}</Td>
                                        <Td numeric>{formatNumber(block.tokenTransferCount)}</Td>
                                        <Td numeric>{formatMs(block.prepareMs)}</Td>
                                        <Td numeric muted={block.commitMs === null}>
                                            {block.commitMs === null ? 'buffered' : formatMs(block.commitMs)}
                                        </Td>
                                        <Td muted>{block.buffered ? 'Buffer' : 'Direct'}</Td>
                                    </Tr>
                                );
                            })}
                        </Tbody>
                    </Table>
                )}
            </Stack>
        </Card>
    );
}
