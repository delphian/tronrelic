'use client';

/**
 * @fileoverview The Buffer stage card: does the feed still have a lead to spend?
 *
 * The buffer holds prepared blocks and releases one per slot, so an upstream
 * hiccup is covered by its lead instead of showing as a gap in the live feed.
 * The number that says whether the lead is big enough is the underrun count,
 * and the old console showed it cumulatively with no time, so one underrun
 * after boot kept the cell amber for the life of the process. This card shows
 * when the last underrun happened, and which release rule the buffer is on,
 * with a link to the buffer settings on the Configuration tab.
 */

import { SlidersHorizontal } from 'lucide-react';
import type { IPipelineStatus } from '@/types';
import { Button } from '../../../../../../components/ui/Button';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { StatStrip } from '../StatStrip';
import { StageCard } from './StageCard';
import { formatNumber, RELEASE_MODE_DISPLAY } from './pipeline-format';

/** Inputs for the Buffer card. */
interface IBufferStageProps {
    /** The pipeline payload. */
    pipeline: IPipelineStatus;
    /** Opens the Configuration tab, where the buffer settings are edited. */
    onOpenSettings: () => void;
}

/** How recent an underrun must be to colour the cell. Matches the health rule. */
const RECENT_UNDERRUN_MS = 10 * 60 * 1000;

/**
 * Render the Buffer stage card.
 *
 * @param props - The payload and a way to reach the buffer settings.
 * @returns The card.
 */
export function BufferStage({ pipeline, onOpenSettings }: IBufferStageProps) {
    const { buffer, config, generatedAt } = pipeline;
    const mode = RELEASE_MODE_DISPLAY[buffer.releaseMode];

    // Judged against the payload's own timestamp rather than the browser clock,
    // so the server render and the first browser render agree.
    const recentUnderrun = buffer.lastUnderrunAt !== null
        && Date.parse(generatedAt) - Date.parse(buffer.lastUnderrunAt) <= RECENT_UNDERRUN_MS;

    return (
        <StageCard
            title="Buffer"
            description="Prepared blocks wait here and are released one per chain slot, so an upstream delay does not reach the live feed."
            actions={(
                <Button variant="ghost" size="xs" icon={<SlidersHorizontal size={14} />} onClick={onOpenSettings}>
                    Buffer settings
                </Button>
            )}
        >
            <StatStrip
                items={[
                    {
                        label: 'Depth',
                        value: `${formatNumber(buffer.depth)} / ${formatNumber(buffer.targetDepth)}`,
                        detail: `Drains fast above ${formatNumber(config.emitBufferCatchupDepth)}, max ${formatNumber(config.emitBufferMaxDepth)}`,
                        tone: buffer.depth >= config.emitBufferMaxDepth ? 'warning' : 'neutral'
                    },
                    {
                        label: 'Release rule',
                        value: mode.label,
                        detail: buffer.lastIntervalMs !== null ? `${mode.hint} (${formatNumber(buffer.lastIntervalMs)} ms)` : mode.hint,
                        tone: buffer.releaseMode === 'catch-up' || buffer.releaseMode === 'burst' ? 'warning' : 'neutral'
                    },
                    {
                        label: 'Underruns',
                        value: formatNumber(buffer.underruns),
                        detail: buffer.lastUnderrunAt
                            ? <>Last <ClientTime date={buffer.lastUnderrunAt} format="relative" />, {formatNumber(buffer.underrunBlocks)} blocks exposed</>
                            : 'None since restart',
                        tone: recentUnderrun ? 'warning' : buffer.underruns > 0 ? 'neutral' : 'success'
                    },
                    {
                        label: 'Catch-up flushes',
                        value: formatNumber(buffer.flushes),
                        detail: 'Buffer emptied at once for catch-up work'
                    }
                ]}
            />
        </StageCard>
    );
}
