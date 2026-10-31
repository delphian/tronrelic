'use client';

/**
 * BotRulePreview — what a rule's conditions would have matched recently.
 *
 * Why it exists: a rule that catches real visitors removes them from the
 * figures it was meant to clean. Before saving, the operator sees how many
 * events and cookies the conditions match and the signs of real people among
 * them — cookies that logged in, cookies that came back on another day, and a
 * spread of referrers — plus a few example events to confirm it is the right
 * traffic. Purely presentational; the form fetches the preview.
 */

import type { IBotRulePreview, IFigureListRow } from '@/types';
import { FigureList } from '../../../../../components/ui/FigureList';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import styles from './BotRules.module.scss';

/** Props for {@link BotRulePreview}. */
interface IBotRulePreviewProps {
    /** The preview to show. */
    preview: IBotRulePreview;
}

/**
 * Render a preview's figures and example events.
 *
 * @param props - The preview.
 * @returns The preview block.
 */
export function BotRulePreview({ preview }: IBotRulePreviewProps) {
    const human = preview.eventsByCurrentLabel.human ?? 0;
    const labels = Object.entries(preview.eventsByCurrentLabel)
        .map(([label, count]) => `${label} ${count.toLocaleString()}`)
        .join(', ');

    const rows: IFigureListRow[] = [
        { key: 'events', label: 'Matched events', value: preview.matchedEvents.toLocaleString(), note: labels || undefined },
        { key: 'relabel', label: 'Would change label', value: human.toLocaleString(), note: 'Events counted as human today' },
        { key: 'cookies', label: 'Matched cookies', value: preview.matchedCookies.toLocaleString() },
        {
            key: 'logged-in',
            label: 'Cookies that logged in',
            value: preview.loggedInCookies.toLocaleString(),
            tone: preview.loggedInCookies > 0 ? 'warning' : 'success',
            note: preview.loggedInCookies > 0 ? 'Real account holders browse from this traffic' : undefined
        },
        {
            key: 'returning',
            label: 'Cookies seen on 2+ days',
            value: preview.returningCookies.toLocaleString(),
            tone: preview.returningCookies > 0 ? 'warning' : 'success',
            note: preview.returningCookies > 0 ? 'Crawlers rarely keep a cookie' : undefined
        },
        { key: 'referrers', label: 'Referrer domains', value: preview.distinctReferrerDomains.toLocaleString() },
        { key: 'agents', label: 'Browser identifiers', value: preview.distinctUserAgents.toLocaleString() }
    ];

    return (
        <section className={styles.preview} aria-label="Rule preview">
            <p className={styles.preview_window}>
                Last {preview.windowDays} {preview.windowDays === 1 ? 'day' : 'days'}. Logged-in visitors never match a rule.
            </p>
            <FigureList rows={rows} label="Preview figures" />
            {preview.samples.length > 0 && (
                <Table variant="compact">
                    <Thead>
                        <Tr>
                            <Th>When</Th>
                            <Th>Type</Th>
                            <Th>Path</Th>
                            <Th>Network</Th>
                            <Th>Browser identifier</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {preview.samples.map((sample, index) => (
                            <Tr key={`${sample.timestamp}-${index}`}>
                                <Td muted><ClientTime date={sample.timestamp} format="short" /></Td>
                                <Td muted>{sample.eventType}</Td>
                                <Td className={styles.cell_wrap}>{sample.path}</Td>
                                <Td muted>{sample.asn !== null ? `AS${sample.asn}` : '—'}{sample.country ? ` · ${sample.country}` : ''}</Td>
                                <Td muted className={styles.cell_wrap}>{sample.userAgent ?? '—'}</Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            )}
        </section>
    );
}
