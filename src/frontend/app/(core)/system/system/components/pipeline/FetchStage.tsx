'use client';

/**
 * @fileoverview The Fetch stage card: is sync ticking, and is it keeping up?
 *
 * Fetching is the first place a stall shows, so the card answers three
 * things: whether the `blockchain:sync` job is running at all, how far behind
 * the chain the newest fetched block is, and how fast blocks are being
 * prepared against how fast the chain produces them. The Run sync control sits
 * here because this is the stage it acts on.
 */

import { useState } from 'react';
import { Play } from 'lucide-react';
import type { IPipelineStatus } from '@/types';
import { Badge } from '../../../../../../components/ui/Badge';
import { Button } from '../../../../../../components/ui/Button';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { useToast } from '../../../../../../components/ui/ToastProvider/ToastProvider';
import { StatStrip } from '../StatStrip';
import { StageCard } from './StageCard';
import { StageTimings } from './StageTimings';
import { triggerSyncTick } from './pipeline-api';
import { formatBlockGap, formatNumber } from './pipeline-format';

/** Inputs for the Fetch card. */
interface IFetchStageProps {
    /** The pipeline payload. */
    pipeline: IPipelineStatus;
    /** Called after a manual tick is requested, so the tab refreshes sooner than its next poll. */
    onChanged: () => void;
}

/** Timing keys that belong to fetching. */
const FETCH_STAGE_KEYS = ['fetchBlock', 'getTrxPrice'];

/**
 * Render the Fetch stage card.
 *
 * @param props - The payload and a refresh callback.
 * @returns The card.
 */
export function FetchStage({ pipeline, onChanged }: IFetchStageProps) {
    const { sync, heights, backfill, config, stages } = pipeline;
    const { push: pushToast } = useToast();
    const [running, setRunning] = useState(false);

    /**
     * Request one sync tick now and refresh shortly after.
     *
     * The refresh waits two seconds so the tick has time to schedule its
     * blocks; refreshing at once would show the state from before it ran.
     */
    const handleRunSync = async () => {
        setRunning(true);
        try {
            await triggerSyncTick();
            pushToast({ tone: 'success', title: 'Sync tick requested', description: 'It skips if a scheduled tick is already running.' });
            setTimeout(onChanged, 2000);
        } catch (error) {
            pushToast({ tone: 'danger', title: 'Sync tick not started', description: error instanceof Error ? error.message : 'Unknown error' });
        } finally {
            setRunning(false);
        }
    };

    // The job's own state, not the ENABLE_SCHEDULER flag: the old console read
    // the flag and kept saying sync was automatic after the job was disabled.
    const jobBadge = !sync.job.registered
        ? <Badge tone="danger" size="sm">Job not registered</Badge>
        : sync.job.enabled
            ? <span title={`Schedule: ${sync.job.schedule ?? 'unknown'}`}><Badge tone="success" size="sm">Job enabled</Badge></span>
            : <Badge tone="danger" size="sm">Job disabled</Badge>;

    return (
        <StageCard
            title="Fetch"
            description="Every sync tick pulls new blocks from TronGrid and queues them for preparation."
            actions={(
                <>
                    {jobBadge}
                    <Button
                        variant="secondary"
                        size="xs"
                        icon={<Play size={14} />}
                        loading={running}
                        onClick={() => void handleRunSync()}
                        title="Run one blockchain:sync tick now"
                    >
                        Run sync now
                    </Button>
                </>
            )}
        >
            <StatStrip
                items={[
                    {
                        label: 'Ingest lag',
                        value: formatNumber(heights.fetched.lagBlocks),
                        detail: heights.fetched.lagBlocks !== null
                            ? `${formatBlockGap(heights.fetched.lagBlocks, config.blockIntervalSeconds)} behind`
                            : 'Nothing fetched yet',
                        tone: heights.fetched.lagTone
                    },
                    {
                        label: 'Ingest rate',
                        value: `${sync.ingestBlocksPerMinute.toFixed(1)}/min`,
                        detail: `Chain makes ${formatNumber(sync.networkBlocksPerMinute)}/min`
                    },
                    {
                        label: 'Last tick',
                        value: sync.lastTickAt ? <ClientTime date={sync.lastTickAt} format="relative" /> : '—',
                        detail: sync.lastBatchSize !== null ? `${formatNumber(sync.lastBatchSize)} blocks scheduled` : 'No tick since restart'
                    },
                    {
                        label: 'Mode',
                        value: sync.mode === 'live' ? 'Live' : sync.mode === 'catch-up' ? 'Catching up' : '—',
                        detail: sync.mode === 'catch-up'
                            ? 'Written at once, not buffered'
                            : 'Blocks go through the buffer',
                        tone: sync.mode === 'catch-up' ? 'warning' : 'neutral'
                    },
                    {
                        label: 'Backfill',
                        value: formatNumber(backfill.size),
                        detail: backfill.size > 0 ? `Oldest ${formatNumber(backfill.oldest)}` : 'No blocks waiting',
                        tone: backfill.size > 0 ? 'warning' : 'neutral'
                    }
                ]}
            />

            {sync.standingError && (
                <p className="alert" role="status">{sync.standingError}</p>
            )}

            <StageTimings stages={stages} keys={FETCH_STAGE_KEYS} />
        </StageCard>
    );
}
