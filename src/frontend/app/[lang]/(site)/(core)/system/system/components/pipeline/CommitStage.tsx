'use client';

/**
 * @fileoverview The Commit stage card: are released blocks being written?
 *
 * A commit writes the block, advances the cursor, notifies observers, and
 * broadcasts `block:new`. The one failure this stage can have that no other
 * figure shows is writing falling behind the release clock, which appears as
 * a commit queue above zero. The old console received that figure and never
 * displayed it; this card leads with it.
 */

import type { IPipelineStatus } from '@/types';
import { StatStrip } from '../StatStrip';
import { StageCard } from './StageCard';
import { StageTimings } from './StageTimings';
import { formatBlockGap, formatNumber } from './pipeline-format';

/** Inputs for the Commit card. */
interface ICommitStageProps {
    /** The pipeline payload. */
    pipeline: IPipelineStatus;
}

/** Timing keys that belong to committing a block. */
const COMMIT_STAGE_KEYS = ['bulkWriteTransactions', 'updateBlockModel', 'updateSyncState', 'commit'];

/**
 * Render the Commit stage card.
 *
 * @param props - The payload.
 * @returns The card.
 */
export function CommitStage({ pipeline }: ICommitStageProps) {
    const { commit, heights, config, errors } = pipeline;
    const commitErrors = errors.filter(error => error.stage === 'commit').length;

    return (
        <StageCard
            title="Commit"
            description="Each released block is written to MongoDB, then observers are notified and the live feed announces it."
        >
            <StatStrip
                items={[
                    {
                        label: 'Commit queue',
                        value: formatNumber(commit.queued),
                        detail: commit.queued > 0 ? 'Writing is behind the release clock' : 'Every released block is written',
                        tone: commit.queued > 3 ? 'warning' : 'success'
                    },
                    {
                        label: 'Feed lag',
                        value: formatNumber(heights.committed.lagBlocks),
                        detail: heights.committed.lagBlocks !== null
                            ? `${formatBlockGap(heights.committed.lagBlocks, config.blockIntervalSeconds)}; ~${formatNumber(config.emitBufferTargetDepth)} by design`
                            : 'Nothing committed yet',
                        tone: heights.committed.lagTone
                    },
                    {
                        label: 'Commit rate',
                        value: `${commit.commitBlocksPerMinute.toFixed(1)}/min`,
                        detail: 'Over the last five minutes'
                    },
                    {
                        label: 'Failures',
                        value: formatNumber(commit.failures),
                        detail: commitErrors > 0 ? `${formatNumber(commitErrors)} in the error history below` : 'Since the backend started',
                        tone: commit.failures > 0 ? 'danger' : 'neutral'
                    }
                ]}
            />

            <StageTimings stages={pipeline.stages} keys={COMMIT_STAGE_KEYS} />
        </StageCard>
    );
}
