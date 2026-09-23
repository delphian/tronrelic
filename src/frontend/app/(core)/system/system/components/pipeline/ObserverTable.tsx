'use client';

/**
 * @fileoverview The observers that receive committed blocks, one row each.
 *
 * Admins said this table was the most useful part of the old console, so its
 * pattern is kept: one row per observer, recency under the name, the per-block
 * cost toned against the block period rather than a fixed number, and
 * exceptions shown only when they are non-zero. What changed is what made it
 * hard to read. Each row now says what kind of observer it is and what it is
 * subscribed to, the processed count says what it counts, the queue is judged
 * against that observer's own capacity, and one error threshold colours both
 * the row and the badge.
 */

import type { IObserverStats } from '@/types';
import { Card } from '../../../../../../components/ui/Card';
import { Stack } from '../../../../../../components/layout';
import { Badge } from '../../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../../components/ui/Table';
import { formatNumber, type BadgeTone } from './pipeline-format';
import styles from './PipelineTab.module.scss';

/** Inputs for the observer table. */
interface IObserverTableProps {
    /** Every registered observer's statistics. */
    observers: IObserverStats[];
    /** Seconds per block, the budget an observer's per-block cost is judged against. */
    blockIntervalSeconds: number;
}

/** Error rate above which an observer reads as failing. */
const ERROR_RATE_DANGER = 0.01;

/** What `totalProcessed` counts for each observer kind. */
const PROCESSED_UNIT: Record<NonNullable<IObserverStats['kind']>, string> = {
    transaction: 'transactions',
    batch: 'transactions',
    block: 'blocks',
    event: 'events'
};

/**
 * Tone for an observer's average work per block.
 *
 * Judged against the block period: work arriving once per block that takes a
 * whole period leaves no margin, and half a period has used most of it.
 *
 * @param avgMs - Average work per block in milliseconds.
 * @param blockIntervalSeconds - Seconds per block.
 * @returns The badge tone.
 */
function avgTimeTone(avgMs: number, blockIntervalSeconds: number): BadgeTone {
    const periodMs = blockIntervalSeconds * 1000;
    let tone: BadgeTone = 'neutral';

    if (avgMs > periodMs) {
        tone = 'danger';
    } else if (avgMs > periodMs * 0.5) {
        tone = 'warning';
    }

    return tone;
}

/**
 * Tone for an observer's queue, as a share of its own capacity.
 *
 * @param stats - The observer's statistics.
 * @returns The badge tone.
 */
function queueTone(stats: IObserverStats): BadgeTone {
    const capacity = stats.queueCapacity ?? 0;
    let tone: BadgeTone = 'neutral';

    if (capacity > 0 && stats.queueDepth >= capacity * 0.9) {
        tone = 'danger';
    } else if (capacity > 0 && stats.queueDepth >= capacity * 0.5) {
        tone = 'warning';
    }

    return tone;
}

/**
 * Tone for an observer's error rate, used for both the badge and the row.
 *
 * @param errorRate - Errors as a share of work attempted.
 * @returns The badge tone.
 */
function errorTone(errorRate: number): BadgeTone {
    let tone: BadgeTone = 'success';

    if (errorRate > ERROR_RATE_DANGER) {
        tone = 'danger';
    } else if (errorRate > 0) {
        tone = 'warning';
    }

    return tone;
}

/**
 * Order observers so the ones needing attention come first.
 *
 * @param observers - The observers to order.
 * @returns A new array: failing and backed-up observers first, then by name.
 */
function sortByAttention(observers: IObserverStats[]): IObserverStats[] {
    /**
     * Score one observer by how much attention it needs.
     *
     * @param stats - The observer's statistics.
     * @returns Higher for more urgent.
     */
    const score = (stats: IObserverStats): number => {
        const tones = [errorTone(stats.errorRate), queueTone(stats)];
        return (tones.includes('danger') ? 4 : 0) + (tones.includes('warning') ? 2 : 0) + (stats.totalDropped > 0 ? 1 : 0);
    };

    return [...observers].sort((left, right) => score(right) - score(left) || left.name.localeCompare(right.name));
}

/**
 * Render the observer table.
 *
 * @param props - Observer statistics and the block period.
 * @returns The card.
 */
export function ObserverTable({ observers, blockIntervalSeconds }: IObserverTableProps) {
    const rows = sortByAttention(observers);

    return (
        <Card padding="sm" noBackgroundImage>
            <Stack gap="sm">
                <header className={styles.card_header}>
                    <h3 className={styles.card_title}>Observers</h3>
                    <span className={styles.card_note}>
                        Plugins and modules that receive each committed block. Time is work per block, judged against the
                        {` ${formatNumber(blockIntervalSeconds)} s `}block period. Rows needing attention come first.
                    </span>
                </header>

                {rows.length === 0 ? (
                    <p className="text-muted">No observers are registered. Enable a plugin that follows transactions to see one here.</p>
                ) : (
                    <Table variant="compact" flush>
                        <Thead>
                            <Tr>
                                <Th scope="col">Observer</Th>
                                <Th scope="col">Subscribed to</Th>
                                <Th scope="col" numeric>Time / block</Th>
                                <Th scope="col" numeric>Queue</Th>
                                <Th scope="col" numeric>Processed</Th>
                                <Th scope="col" numeric>Errors</Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {rows.map(observer => {
                                const errors = errorTone(observer.errorRate);
                                const unit = observer.kind ? PROCESSED_UNIT[observer.kind] : 'items';
                                return (
                                    <Tr key={observer.name} hasError={errors === 'danger'}>
                                        <Td>
                                            <strong>{observer.name}</strong>
                                            <span className={styles.row_meta}>
                                                {observer.kind ? `${observer.kind} observer` : 'observer'}
                                                {observer.lastProcessedAt && (
                                                    <> · last <ClientTime date={observer.lastProcessedAt} format="relative" /></>
                                                )}
                                            </span>
                                        </Td>
                                        <Td muted>{observer.subscriptions?.join(', ') || '—'}</Td>
                                        <Td numeric>
                                            <Badge tone={avgTimeTone(observer.avgProcessingTimeMs, blockIntervalSeconds)} size="xs">
                                                {`${observer.avgProcessingTimeMs.toFixed(1)} ms`}
                                            </Badge>
                                            <span className={styles.row_meta}>
                                                {formatNumber(observer.minProcessingTimeMs)}–{formatNumber(observer.maxProcessingTimeMs)} ms
                                            </span>
                                        </Td>
                                        <Td numeric>
                                            <Badge tone={queueTone(observer)} size="xs">
                                                {observer.queueCapacity
                                                    ? `${formatNumber(observer.queueDepth)} / ${formatNumber(observer.queueCapacity)}`
                                                    : formatNumber(observer.queueDepth)}
                                            </Badge>
                                        </Td>
                                        <Td numeric>
                                            {formatNumber(observer.totalProcessed)}
                                            <span className={styles.row_meta}>{unit}</span>
                                        </Td>
                                        <Td numeric>
                                            <Badge tone={errors} size="xs">
                                                {`${formatNumber(observer.totalErrors)} (${(observer.errorRate * 100).toFixed(2)}%)`}
                                            </Badge>
                                            {observer.totalDropped > 0 && (
                                                <Badge tone="danger" size="xs">{`${formatNumber(observer.totalDropped)} dropped`}</Badge>
                                            )}
                                            {observer.lastErrorAt && (
                                                <span className={styles.row_meta}>
                                                    last <ClientTime date={observer.lastErrorAt} format="relative" />
                                                </span>
                                            )}
                                        </Td>
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
