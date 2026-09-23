'use client';

/**
 * @fileoverview Recent pipeline failures and the backfill queue.
 *
 * The sync state document keeps one error, and the next healthy tick erases
 * it, so an operator polling the old console usually never saw a block
 * failure. The backend now keeps a short history, and this card lists it with
 * the stage and a short class such as `HTTP 429`, beside the blocks waiting to
 * be fetched again.
 */

import type { IPipelineStatus } from '@/types';
import { Card } from '../../../../../../components/ui/Card';
import { Stack } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { formatNumber } from './pipeline-format';
import styles from './PipelineTab.module.scss';

/** Inputs for the errors card. */
interface IPipelineErrorsProps {
    /** The pipeline payload. */
    pipeline: IPipelineStatus;
}

/** Stage names as the stage cards title them. */
const STAGE_NAMES: Record<IPipelineStatus['errors'][number]['stage'], string> = {
    schedule: 'Fetch (tick)',
    fetch: 'Fetch',
    commit: 'Commit'
};

/**
 * Render the error history and the backfill queue.
 *
 * @param props - The payload.
 * @returns The card.
 */
export function PipelineErrors({ pipeline }: IPipelineErrorsProps) {
    const { errors, backfill } = pipeline;

    return (
        <Card padding="sm" noBackgroundImage>
            <Stack gap="sm">
                <header className={styles.card_header}>
                    <h3 className={styles.card_title}>Errors and backfill</h3>
                    <span className={styles.card_note}>
                        {backfill.size > 0
                            ? `${formatNumber(backfill.size)} blocks waiting to be fetched again (${backfill.sample.map(formatNumber).join(', ')}${backfill.size > backfill.sample.length ? ', …' : ''})`
                            : 'No blocks waiting to be fetched again'}
                    </span>
                </header>

                {errors.length === 0 ? (
                    <p className="text-muted">No pipeline errors since the backend started.</p>
                ) : (
                    <Table variant="compact" flush>
                        <Thead>
                            <Tr>
                                <Th scope="col">When</Th>
                                <Th scope="col">Stage</Th>
                                <Th scope="col" numeric>Block</Th>
                                <Th scope="col">Class</Th>
                                <Th scope="col" width="expand">Message</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {errors.map((error, index) => (
                                <Tr key={`${error.at}-${index}`} hasError={error.stage === 'commit'}>
                                    <Td><ClientTime date={error.at} format="relative" /></Td>
                                    <Td>{STAGE_NAMES[error.stage]}</Td>
                                    <Td numeric>{formatNumber(error.blockNumber)}</Td>
                                    <Td><Badge tone={error.stage === 'commit' ? 'danger' : 'warning'} size="xs">{error.errorClass}</Badge></Td>
                                    <Td muted>{error.message}</Td>
                                </Tr>
                            ))}
                        </Tbody>
                    </Table>
                )}
            </Stack>
        </Card>
    );
}
