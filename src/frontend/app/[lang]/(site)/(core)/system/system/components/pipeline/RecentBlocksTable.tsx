'use client';

/**
 * @fileoverview The newest prepared blocks, one row each.
 *
 * Aggregates say how the pipeline is doing on average; this table shows what
 * happened to each recent block, which is what an operator reads when an
 * aggregate looks wrong: whether its receipts arrived, how many events and
 * token transfers were decoded, how long it took, and whether it went through
 * the buffer or was written straight away as catch-up work.
 *
 * On a narrow tab the rows stack into entries, and the list shows only the
 * newest few until the operator asks for the rest (see `PipelineTab.module.scss`).
 */

import { useState } from 'react';
import type { IPipelineStatus } from '@/types';
import { Panel } from '../../../../../../../../components/ui/Panel';
import { Badge } from '../../../../../../../../components/ui/Badge';
import { Button } from '../../../../../../../../components/ui/Button';
import { ClientTime } from '../../../../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../../../components/ui/Table';
import { formatMs, formatNumber, RECEIPT_OUTCOME_DISPLAY } from './pipeline-format';
import styles from './PipelineTab.module.scss';

/** Blocks a narrow tab shows before the operator opens the rest. */
const NARROW_VISIBLE_BLOCKS = 5;

/** Inputs for the recent blocks table. */
interface IRecentBlocksTableProps {
    /** The pipeline payload. */
    pipeline: IPipelineStatus;
}

/**
 * Describe how one block was committed, in one cell.
 *
 * The commit time and the path a block took are read together, and as two
 * columns they repeated each other: a block still in the buffer showed
 * "buffered" under Commit and "Buffer" under Path.
 *
 * @param commitMs - Time the commit took, or null while the block is still buffered.
 * @param buffered - Whether the block went through the buffer rather than straight to commit.
 * @returns For example `189 ms · Buffer`, `42 ms · Direct`, or `In buffer`.
 */
function describeCommit(commitMs: number | null, buffered: boolean): string {
    return commitMs === null ? 'In buffer' : `${formatMs(commitMs)} · ${buffered ? 'Buffer' : 'Direct'}`;
}

/**
 * Render the recent blocks table.
 *
 * @param props - The payload.
 * @returns The panel.
 */
export function RecentBlocksTable({ pipeline }: IRecentBlocksTableProps) {
    const { recentBlocks } = pipeline;
    const [showAll, setShowAll] = useState(false);
    const hasHidden = recentBlocks.length > NARROW_VISIBLE_BLOCKS;

    return (
        <Panel
            title="Recent blocks"
            titleAs="h3"
            meta="Newest first. A block still in the buffer has no commit time yet."
            className={styles.recent_panel}
            actions={hasHidden && (
                <span className={styles.recent_toggle}>
                    <Button variant="ghost" onClick={() => setShowAll(current => !current)} aria-expanded={showAll}>
                        {showAll ? `Show newest ${NARROW_VISIBLE_BLOCKS}` : `Show all ${recentBlocks.length}`}
                    </Button>
                </span>
            )}
        >
            {recentBlocks.length === 0 ? (
                <p className="text-muted">No blocks prepared since the backend started.</p>
            ) : (
                <Table variant="compact" flush stackAt="mobile" className={styles.recent_table}>
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
                        </Tr>
                    </Thead>
                    <Tbody>
                        {recentBlocks.map((block, index) => {
                            const receipt = RECEIPT_OUTCOME_DISPLAY[block.receiptOutcome];
                            const hiddenWhenNarrow = !showAll && index >= NARROW_VISIBLE_BLOCKS;
                            return (
                                <Tr
                                    key={`${block.blockNumber}-${block.preparedAt}`}
                                    className={hiddenWhenNarrow ? styles.recent_extra : undefined}
                                >
                                    {/* No label: the block number heads a stacked entry. */}
                                    <Td numeric>{formatNumber(block.blockNumber)}</Td>
                                    <Td label="Produced"><ClientTime date={block.blockTimestamp} format="relative" /></Td>
                                    <Td label="Txs" numeric>{formatNumber(block.transactionCount)}</Td>
                                    <Td label="Receipts">
                                        <span title={receipt.hint}>
                                            <Badge tone={receipt.tone} size="xs">{receipt.label}</Badge>
                                        </span>
                                    </Td>
                                    <Td label="Events" numeric>{formatNumber(block.eventCount)}</Td>
                                    <Td label="Transfers" numeric>{formatNumber(block.tokenTransferCount)}</Td>
                                    <Td label="Prepare" numeric>{formatMs(block.prepareMs)}</Td>
                                    <Td label="Commit" numeric muted={block.commitMs === null}>
                                        {describeCommit(block.commitMs, block.buffered)}
                                    </Td>
                                </Tr>
                            );
                        })}
                    </Tbody>
                </Table>
            )}
        </Panel>
    );
}
