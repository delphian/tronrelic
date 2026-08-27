'use client';

/**
 * @fileoverview Vocabulary summary above the address-tags management table:
 * how many distinct tags exist, how much of the collection each one accounts
 * for, and one click to filter the table below by any of them.
 *
 * The table underneath answers "what is this address labelled as". Nothing
 * answered the opposite question — "which labels do we actually use, and how
 * much" — so a tag that was really a typo of an existing one, or a category
 * nobody had used since it was created, was invisible until someone happened to
 * scroll past it. This panel is that missing view.
 *
 * The form is a sorted bar list rather than a tag cloud. A cloud encodes the
 * count as type size, which reads as emphasis and cannot be compared between
 * two tags that are not adjacent; a list ordered by count with the number
 * printed beside each bar can be both scanned and read exactly. The bars are a
 * single hue because there is one measure here — magnitude — and a colour per
 * tag would imply an identity the data does not carry.
 *
 * Every row is also a filter. Clicking one commits its tag as the table's
 * search term, which is why the counts sit directly above the table rather than
 * on a tab of their own: the summary is how an operator picks what to look at
 * next, and a count is only useful if you can reach the rows behind it.
 *
 * Like the rest of this page it fetches its own admin endpoint after mount
 * rather than being SSR-seeded. The SSR + Live Updates mandate covers
 * public-facing content, and /system admin surfaces are exempt by the dashboard
 * convention — see the note at the top of `AddressTagsManager`.
 */

import { useCallback, useEffect, useState, type CSSProperties } from 'react';
import { ChevronDown, ChevronUp, Hash, Tags, Wallet, X } from 'lucide-react';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { StatGrid, StatTile } from '../../../../components/ui/StatTile';
import { Stack } from '../../../../components/layout';
import { useToast } from '../../../../components/ui/ToastProvider';
import { cn } from '../../../../lib/cn';
import { getTagSummary, type IAddressTagSummary } from '../../../../modules/address-tags';
import styles from './page.module.scss';

/**
 * How many tag rows the server is asked for. Far above any realistic tag
 * vocabulary, so the list the panel holds is normally the complete one and
 * expanding it costs no second request. The server clamps this to its own
 * ceiling, and reports `totalTags` regardless, so a deployment that somehow
 * exceeds it still gets an honest "showing N of M" line instead of a list that
 * silently stops.
 */
const FETCH_LIMIT = 1000;

/**
 * Rows shown before the reader asks for the rest. Ten is enough to see the
 * shape of the distribution — which tags dominate and roughly by how much —
 * without the panel pushing the management table off the screen.
 */
const COLLAPSED_ROWS = 10;

/**
 * Props for the summary panel.
 */
interface ITagSummaryPanelProps {
    /**
     * The tag whose row should read as selected, or null for none. The manager
     * passes its committed search term, so the highlight follows what the table
     * is actually filtered by — including when the operator typed the tag into
     * the search box instead of clicking its row.
     */
    activeTag: string | null;

    /**
     * Apply a tag as the table's filter, or clear it when passed null. The
     * panel does not hold the filter itself; the table below owns that state
     * and this is how a row hands it over.
     */
    onSelectTag: (tag: string | null) => void;

    /**
     * Changes value whenever the manager has mutated a tag. Counts are derived
     * from the same documents the table edits, so without a signal to refetch,
     * deleting the last address under a tag would leave that tag sitting in
     * this list with a count of one for the rest of the session.
     */
    reloadToken: number;
}

/**
 * Format a count for display with thousands separators.
 *
 * Wrapped in a helper rather than called inline so every figure in the panel —
 * the totals strip and each row — goes through the same formatting, and so the
 * one place that decides it is easy to find if these ever need a compact form.
 *
 * @param value - The raw count from the server.
 * @returns The count as display text.
 */
function formatCount(value: number): string {
    return value.toLocaleString();
}

/**
 * The tag vocabulary summary: totals strip, sorted bar list, and the expand
 * control.
 *
 * @param props - The active filter, the callback that applies one, and the
 *        token that forces a refetch after a mutation.
 * @returns The panel, or a placeholder card while the first load is in flight.
 */
export function TagSummaryPanel({ activeTag, onSelectTag, reloadToken }: ITagSummaryPanelProps) {
    const [summary, setSummary] = useState<IAddressTagSummary | null>(null);
    const [loading, setLoading] = useState(true);
    const [expanded, setExpanded] = useState(false);
    const { push } = useToast();

    useEffect(() => {
        let cancelled = false;

        /**
         * Load the summary for the current reload token, discarding the result
         * if the effect has already been cleaned up. Without that guard a slow
         * response from a superseded request could land after a newer one and
         * repaint the panel with pre-mutation counts.
         */
        const load = async (): Promise<void> => {
            try {
                const next = await getTagSummary(FETCH_LIMIT);
                if (!cancelled) {
                    setSummary(next);
                }
            } catch (error) {
                if (!cancelled) {
                    push({
                        tone: 'danger',
                        title: 'Failed to load tag summary',
                        description: error instanceof Error ? error.message : String(error)
                    });
                }
            } finally {
                if (!cancelled) {
                    setLoading(false);
                }
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [push, reloadToken]);

    /**
     * Toggle a row: clicking the tag the table is already filtered by clears
     * the filter instead of re-applying it, so the row doubles as its own
     * undo and the operator never has to go and empty the search box by hand.
     *
     * What this hands over is a search term, not an exact-tag query, because
     * the table's only filter is the substring search. Clicking `whale` can
     * therefore also list an address tagged `whale-watch`, and the table can
     * show more rows than the count on the row that was clicked. That reads
     * correctly in place — the search box shows `whale` and the extra row
     * visibly carries the longer tag — and it is the reason the count is
     * described as addresses carrying the tag rather than as a row count.
     *
     * @param tag - The tag on the clicked row.
     */
    const handleRowClick = useCallback((tag: string) => {
        onSelectTag(activeTag === tag ? null : tag);
    }, [activeTag, onSelectTag]);

    if (!summary) {
        return (
            <Card>
                <div className={styles.placeholder}>
                    {loading ? 'Loading tag summary…' : 'Tag summary unavailable.'}
                </div>
            </Card>
        );
    }

    if (summary.totalTags === 0) {
        return (
            <Card>
                <div className={styles.placeholder}>No tags stored yet.</div>
            </Card>
        );
    }

    const visibleTags = expanded ? summary.tags : summary.tags.slice(0, COLLAPSED_ROWS);
    // Bars are scaled against the largest count rather than the total, so the
    // busiest tag fills the track and the rest read as a share of it. Scaling
    // against the assignment total would leave every bar a sliver on a
    // collection with a broad vocabulary, which is the case this panel exists
    // to make legible.
    const busiest = summary.tags[0]?.addresses ?? 1;
    const hasMore = summary.tags.length > COLLAPSED_ROWS;

    return (
        <Card className={styles.tag_summary}>
            <Stack gap="md">
                <StatGrid size="sm">
                    <StatTile
                        size="sm"
                        surface={false}
                        icon={<Tags size={14} />}
                        label="Distinct tags"
                        value={formatCount(summary.totalTags)}
                    />
                    <StatTile
                        size="sm"
                        surface={false}
                        icon={<Wallet size={14} />}
                        label="Tagged addresses"
                        value={formatCount(summary.totalAddresses)}
                    />
                    <StatTile
                        size="sm"
                        surface={false}
                        icon={<Hash size={14} />}
                        label="Tag assignments"
                        value={formatCount(summary.totalAssignments)}
                        note="One per address and tag"
                    />
                </StatGrid>

                <ul className={styles.tag_bars}>
                    {visibleTags.map((row) => {
                        const selected = row.tag === activeTag;
                        return (
                            <li key={row.tag}>
                                <button
                                    type="button"
                                    className={cn(styles.tag_bar, selected && styles['tag_bar--selected'])}
                                    onClick={() => handleRowClick(row.tag)}
                                    aria-pressed={selected}
                                    aria-label={
                                        selected
                                            ? `Clear the filter on tag ${row.tag}`
                                            : `Filter the table by tag ${row.tag}, on ${formatCount(row.addresses)} addresses`
                                    }
                                >
                                    <span className={styles.tag_bar__label}>{row.tag}</span>
                                    {/* Decorative: the count sits beside it in
                                      * text, so a screen reader announcing the
                                      * track as well would only repeat it. */}
                                    <span
                                        className={styles.tag_bar__track}
                                        aria-hidden="true"
                                        style={{ '--tag-bar-fill': `${(row.addresses / busiest) * 100}%` } as CSSProperties}
                                    >
                                        <span className={styles.tag_bar__fill} />
                                    </span>
                                    <span className={styles.tag_bar__value}>{formatCount(row.addresses)}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>

                <div className={styles.tag_bars__footer}>
                    <span className={styles.tag_bars__note}>
                        {`Showing ${formatCount(visibleTags.length)} of ${formatCount(summary.totalTags)} tags, most used first.`}
                    </span>
                    <div className={styles.tag_bars__actions}>
                        {activeTag && (
                            <Button variant="ghost" size="sm" onClick={() => onSelectTag(null)}>
                                <X size={14} /> Clear filter
                            </Button>
                        )}
                        {hasMore && (
                            <Button variant="secondary" size="sm" onClick={() => setExpanded((current) => !current)}>
                                {expanded
                                    ? <><ChevronUp size={14} /> Show fewer</>
                                    : <><ChevronDown size={14} /> Show all</>}
                            </Button>
                        )}
                    </div>
                </div>
            </Stack>
        </Card>
    );
}
