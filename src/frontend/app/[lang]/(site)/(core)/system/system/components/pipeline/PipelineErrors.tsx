'use client';

/**
 * @fileoverview Recent pipeline failures and the backfill queue.
 *
 * The sync state document keeps one error, and the next healthy tick erases
 * it, so polling that document rarely shows a block failure. The backend keeps
 * a short history, and this card lists it with the stage and a short class
 * such as `HTTP 429`, beside the blocks waiting to be fetched again.
 */

import type { IPipelineStatus } from '@/types';
import { Panel } from '../../../../../../../../components/ui/Panel';
import { Badge } from '../../../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../../../components/ui/Table';
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
 * The four short columns are shrink columns, so they keep their text on one
 * line and the message takes the rest of the width rather than squeezing
 * "6m ago" and "Fetch (tick)" onto two lines each. The message may break
 * inside a long token, such as a duplicate key's hash, because with the short
 * columns held at their one-line width nothing else can give the table room.
 *
 * @param props - The payload.
 * @returns The panel.
 */
export function PipelineErrors({ pipeline }: IPipelineErrorsProps) {
    const { errors, backfill } = pipeline;

    return (
        <Panel
            title="Errors and backfill"
            titleAs="h3"
            meta={backfill.size > 0
                ? `${formatNumber(backfill.size)} blocks waiting to be fetched again (${backfill.sample.map(formatNumber).join(', ')}${backfill.size > backfill.sample.length ? ', …' : ''})`
                : 'No blocks waiting to be fetched again'}
        >
            {errors.length === 0 ? (
                <p className="text-muted">No pipeline errors since the backend started.</p>
            ) : (
                <Table variant="compact" flush stackAt="mobile">
                    <Thead>
                        <Tr>
                            <Th scope="col" width="shrink">When</Th>
                            <Th scope="col" width="shrink">Stage</Th>
                            <Th scope="col" width="shrink" numeric>Block</Th>
                            <Th scope="col" width="shrink">Class</Th>
                            <Th scope="col" width="expand">Message</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {errors.map((error, index) => (
                            <Tr key={`${error.at}-${index}`} hasError={error.stage === 'commit'}>
                                <Td label="When"><ClientTime date={error.at} format="relative" /></Td>
                                <Td label="Stage">{STAGE_NAMES[error.stage]}</Td>
                                <Td label="Block" numeric>{formatNumber(error.blockNumber)}</Td>
                                <Td label="Class"><Badge tone={error.stage === 'commit' ? 'danger' : 'warning'} size="xs">{error.errorClass}</Badge></Td>
                                <Td label="Message" stackSpan="full" muted className={styles.message}>{error.message}</Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            )}
        </Panel>
    );
}
