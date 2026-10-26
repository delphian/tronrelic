'use client';

/**
 * @fileoverview The Chain data card: is the ClickHouse copy of the chain complete?
 *
 * Every committed block is copied into ClickHouse once, and a block that misses
 * that copy used to stay missing with nothing on screen to say so; operators
 * found out when a report built on the data came back incomplete. The repair job
 * now checks the copy every few minutes and refetches what is missing, and this
 * card shows its last result: how many blocks were missing, how many it
 * refetched, and how many remain. A deployment without ClickHouse has no copy,
 * so the card is not shown there.
 */

import type { IPipelineStatus } from '@/types';
import { Badge } from '../../../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../../../components/ui/ClientTime';
import { StatStrip } from '../StatStrip';
import { StageCard } from './StageCard';
import { CHAIN_DATA_STATUS_DISPLAY, formatMs, formatNumber } from './pipeline-format';

/** Inputs for the Chain data card. */
interface IChainDataStageProps {
    /** The pipeline payload. */
    pipeline: IPipelineStatus;
}

/**
 * Render the Chain data card, or nothing when the deployment has no ClickHouse.
 *
 * @param props - The payload.
 * @returns The card, or null.
 */
export function ChainDataStage({ pipeline }: IChainDataStageProps) {
    const { chainData } = pipeline;
    let card = null;

    if (chainData) {
        const display = CHAIN_DATA_STATUS_DISPLAY[chainData.status];
        const missing = chainData.missingBlocks + chainData.partialBlocks;
        const range = chainData.oldestMissing !== null && chainData.newestMissing !== null
            ? `Blocks ${formatNumber(chainData.oldestMissing)}–${formatNumber(chainData.newestMissing)}`
            : `None in the last ${formatNumber(chainData.windowDays)} days`;

        card = (
            <StageCard
                title="Chain data"
                description="Each committed block is copied into ClickHouse. A repair job checks the copy every five minutes and refetches any block that is missing."
                actions={<Badge tone={display.tone} size="sm">{display.label}</Badge>}
            >
                <StatStrip
                    items={[
                        {
                            label: 'Missing',
                            value: formatNumber(missing),
                            detail: chainData.partialBlocks > 0
                                ? `${range}; ${formatNumber(chainData.partialBlocks)} written only in part`
                                : range,
                            tone: missing === 0 ? 'success' : chainData.consecutiveRunsWithGaps >= 2 ? 'warning' : 'neutral'
                        },
                        {
                            label: 'Last 24 hours',
                            value: formatNumber(chainData.missingLast24h),
                            detail: 'Missing blocks in holes ending in the last day',
                            tone: chainData.missingLast24h > 0 ? 'warning' : 'neutral'
                        },
                        {
                            label: 'Repaired',
                            value: formatNumber(chainData.repaired),
                            detail: chainData.repairFailures > 0
                                ? `${formatNumber(chainData.repairFailures)} refetches failed in the last run`
                                : `${formatNumber(chainData.remaining)} left after the last run`,
                            tone: chainData.repairFailures > 0 ? 'warning' : 'neutral'
                        },
                        {
                            label: 'Last check',
                            value: chainData.lastRunAt ? <ClientTime date={chainData.lastRunAt} format="relative" /> : '—',
                            detail: chainData.message ?? (chainData.lastRunDurationMs !== null
                                ? `${display.hint}; took ${formatMs(chainData.lastRunDurationMs)}`
                                : display.hint),
                            tone: chainData.status === 'failed' ? 'danger' : 'neutral'
                        }
                    ]}
                />
            </StageCard>
        );
    }

    return card;
}
