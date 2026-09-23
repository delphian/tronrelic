'use client';

/**
 * @fileoverview Median and 95th percentile timings for one pipeline stage card.
 *
 * The old console showed one block's timings, which changed on every poll and
 * could not say whether a stage was usually slow or slow once. Each stage card
 * now ends with this table of its own sub-steps over recent blocks.
 */

import type { IPipelineStageTiming } from '@/types';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { formatMs, formatNumber, STAGE_LABELS } from './pipeline-format';

/** Inputs for the timing table. */
interface IStageTimingsProps {
    /** Every stage timing in the payload. */
    stages: IPipelineStageTiming[];
    /** The stage keys this card owns, in the order to show them. */
    keys: string[];
}

/**
 * Render the timing rows for the given stage keys.
 *
 * Rendered flush because it is always the last thing in its stage card, so it
 * runs to the card's edges instead of drawing a second border inside it.
 *
 * @param props - All timings and the keys to show.
 * @returns The table, or a short note when no block has been timed yet.
 */
export function StageTimings({ stages, keys }: IStageTimingsProps) {
    const rows = keys
        .map(key => stages.find(stage => stage.stage === key))
        .filter((stage): stage is IPipelineStageTiming => stage !== undefined);

    return rows.length === 0 ? (
        <p className="text-muted">No blocks timed since the backend started.</p>
    ) : (
        <Table variant="compact" flush>
            <Thead>
                <Tr>
                    <Th scope="col">Step</Th>
                    <Th scope="col" numeric>Median</Th>
                    <Th scope="col" numeric>95th pct</Th>
                    <Th scope="col" numeric>Max</Th>
                </Tr>
            </Thead>
            <Tbody>
                {rows.map(stage => (
                    <Tr key={stage.stage}>
                        <Td>
                            {STAGE_LABELS[stage.stage] ?? stage.stage}
                            <span className="text-subtle"> · {formatNumber(stage.samples)} blocks</span>
                        </Td>
                        <Td numeric>{formatMs(stage.p50)}</Td>
                        <Td numeric>{formatMs(stage.p95)}</Td>
                        <Td numeric muted>{formatMs(stage.max)}</Td>
                    </Tr>
                ))}
            </Tbody>
        </Table>
    );
}
