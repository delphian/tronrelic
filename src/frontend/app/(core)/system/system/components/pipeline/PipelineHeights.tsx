'use client';

/**
 * @fileoverview Where each part of the block pipeline has reached.
 *
 * The question an operator asks after "is it healthy?" is "where is it
 * stuck?". The old console answered with two lag figures that were nearly the
 * same number under different names, and never showed how far fetching had
 * got. This view lays the pipeline out left to right — chain head, fetched,
 * buffered, committed — with the gap between each pair written on the
 * connector, so a stall shows as one gap growing while the others hold.
 */

import type { ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type { IPipelineStatus, PipelineTone } from '@/types';
import { Badge } from '../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { cn } from '../../../../../../lib/cn';
import { formatBlockGap, formatNumber, RELEASE_MODE_DISPLAY } from './pipeline-format';
import styles from './PipelineHeights.module.scss';

/** Inputs for the heights view. */
interface IPipelineHeightsProps {
    /** The pipeline payload. */
    pipeline: IPipelineStatus;
}

/** One node in the flow. */
interface IHeightNodeProps {
    /** What the node is, for example "Fetched". */
    label: string;
    /** The headline figure, usually a block height. */
    value: string;
    /** One line of context under the value. */
    detail: ReactNode;
    /** Tone for the node's left rule. */
    tone: PipelineTone;
}

/** Style class for each tone on a node. */
const TONE_CLASS: Record<PipelineTone, string | undefined> = {
    success: styles.node_success,
    warning: styles.node_warning,
    danger: styles.node_danger,
    neutral: undefined
};

/**
 * Render one stage of the flow.
 *
 * @param props - Label, figure, context line, and tone.
 * @returns The node.
 */
function HeightNode({ label, value, detail, tone }: IHeightNodeProps) {
    return (
        <div className={cn(styles.node, TONE_CLASS[tone])}>
            <span className={styles.node_label}>{label}</span>
            <span className={styles.node_value}>{value}</span>
            <span className={styles.node_detail}>{detail}</span>
        </div>
    );
}

/**
 * Render the arrow between two nodes, labelled with the gap it spans.
 *
 * @param props.gap - Text describing the distance between the two nodes.
 * @returns The connector.
 */
function Connector({ gap }: { gap: string }) {
    return (
        <div className={styles.connector} aria-hidden="true">
            <ArrowRight size={16} />
            <span className={styles.connector_gap}>{gap}</span>
        </div>
    );
}

/**
 * Compute the distance between two heights, when both are known.
 *
 * @param upper - The further-along height.
 * @param lower - The height behind it.
 * @returns The non-negative difference, or null when either is unknown.
 */
function heightGap(upper: number | null, lower: number | null): number | null {
    return upper !== null && lower !== null ? Math.max(0, upper - lower) : null;
}

/**
 * Render the heights flow.
 *
 * @param props - The pipeline payload.
 * @returns The flow of four nodes with labelled connectors.
 */
export function PipelineHeights({ pipeline }: IPipelineHeightsProps) {
    const { heights, buffer, config } = pipeline;
    const interval = config.blockIntervalSeconds;
    const mode = RELEASE_MODE_DISPLAY[buffer.releaseMode];

    // The outer element is the query container and the inner one is the grid,
    // because a container query styles the container's descendants, never the
    // container itself.
    return (
        <div className={styles.heights}>
            <div className={styles.flow} role="group" aria-label="Pipeline heights">
                <HeightNode
                    label="Chain head"
                    value={formatNumber(heights.head.blockNumber)}
                    tone={heights.head.fromCache ? 'warning' : 'neutral'}
                    detail={heights.head.observedAt ? (
                        <>
                            Seen <ClientTime date={heights.head.observedAt} format="relative" />
                            {heights.head.fromCache && <Badge tone="warning" size="xs">cached</Badge>}
                        </>
                    ) : 'No sync tick yet'}
                />
                <Connector gap={`${formatNumber(heightGap(heights.head.blockNumber, heights.fetched.blockNumber))} to fetch`} />
                <HeightNode
                    label="Fetched"
                    value={formatNumber(heights.fetched.blockNumber)}
                    tone={heights.fetched.lagTone}
                    detail={heights.fetched.lagBlocks !== null
                        ? `Ingest lag ${formatBlockGap(heights.fetched.lagBlocks, interval)}`
                        : 'No block prepared since restart'}
                />
                <Connector gap={`${formatNumber(buffer.depth)} held`} />
                <HeightNode
                    label="Buffered"
                    value={`${formatNumber(buffer.depth)} / ${formatNumber(buffer.targetDepth)}`}
                    tone={buffer.releaseMode === 'catch-up' || buffer.releaseMode === 'burst' ? 'warning' : 'neutral'}
                    detail={<span title={mode.hint}>{mode.label}</span>}
                />
                <Connector gap="released" />
                <HeightNode
                    label="Committed"
                    value={formatNumber(heights.committed.blockNumber)}
                    tone={heights.committed.lagTone}
                    detail={heights.committed.lagBlocks !== null
                        ? `Feed lag ${formatBlockGap(heights.committed.lagBlocks, interval)}`
                        : 'No block committed since restart'}
                />
            </div>
        </div>
    );
}
