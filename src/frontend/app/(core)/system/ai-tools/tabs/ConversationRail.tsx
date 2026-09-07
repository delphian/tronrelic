'use client';

/**
 * @file ConversationRail.tsx
 *
 * The list of past conversations beside the chat, grouped by day with the
 * newest first. It replaces the History view that used to swap the chat out
 * of the page: a conversation is opened by clicking its row, in place, so the
 * operator never loses sight of the chat they are in to find another one.
 *
 * The rail is presentation only. The parent owns the records, the paging, and
 * the open action, because those are shared with the chat — a finished stream
 * refreshes the list, and opening a row replaces the transcript.
 *
 * A client-only admin surface: the list arrives from the parent after mount,
 * so the day labels (computed with the browser's local date) are never
 * rendered on the server and carry no hydration risk.
 */

import { useMemo } from 'react';
import { RefreshCw, Copy, CheckCircle, MessageSquare } from 'lucide-react';
import type { AiQueryOutcome } from '@/types';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { IconButton } from '../../../../../components/ui/IconButton';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { formatUsd } from './formatUsd';
import type { IConversationGroup } from './IConversationGroup';
import styles from './ConversationRail.module.scss';

/**
 * Badge text for each way a run can end without answering. Naming the outcome
 * on the row is what makes the list actionable: "Truncated" points an operator
 * at the token budget while "Tool limit" points at the round budget, and a
 * single shared "Incomplete" label would send them to read every transcript to
 * find out which. `answered` and `failed` are absent because those two have
 * their own presentation — no badge, and the danger badge, respectively.
 */
const INCOMPLETE_OUTCOME_LABELS: Partial<Record<AiQueryOutcome, string>> = {
    truncated: 'Truncated',
    'tool-limit': 'Tool limit',
    paused: 'Paused',
    refused: 'Refused',
    empty: 'No answer'
};

/** One day's worth of rows, with the heading the section renders. */
interface IDaySection {
    label: string;
    groups: IConversationGroup[];
}

/**
 * Name the day a timestamp falls on relative to today, the way a message list
 * does: "Today", "Yesterday", then a short date. Relative names for the two
 * most recent days are what let an operator find last night's scheduled run
 * without reading dates.
 *
 * @param iso - The conversation's latest-turn timestamp.
 * @param now - The current time, passed in so every row in one render agrees
 *   on what "today" is.
 * @returns The section heading for that day.
 */
function dayLabel(iso: string, now: Date): string {
    const date = new Date(iso);
    const startOfDay = (value: Date): number => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime();
    const dayMs = 24 * 60 * 60 * 1000;
    const difference = Math.round((startOfDay(now) - startOfDay(date)) / dayMs);
    let label: string;
    if (difference <= 0) {
        label = 'Today';
    } else if (difference === 1) {
        label = 'Yesterday';
    } else {
        label = date.toLocaleDateString(undefined, {
            month: 'short',
            day: 'numeric',
            ...(date.getFullYear() === now.getFullYear() ? {} : { year: 'numeric' })
        });
    }
    return label;
}

/**
 * Split a newest-first list of conversations into day sections, preserving
 * order. Consecutive rows sharing a day label fall into one section.
 *
 * @param groups - Conversations, newest first.
 * @returns The sections in the same order.
 */
function sectionByDay(groups: IConversationGroup[]): IDaySection[] {
    const now = new Date();
    const sections: IDaySection[] = [];
    for (const group of groups) {
        const label = dayLabel(group.lastAt, now);
        const last = sections[sections.length - 1];
        if (last && last.label === label) {
            last.groups.push(group);
        } else {
            sections.push({ label, groups: [group] });
        }
    }
    return sections;
}

/** Props for {@link ConversationRail}. */
export interface IConversationRailProps {
    /** Conversations, newest first. */
    groups: IConversationGroup[];
    /** The conversation open in the chat, so its row reads as selected. */
    activeConversationId: string | null;
    /** Whether the first page is still loading. */
    loading: boolean;
    /** Why the list could not load, or null. */
    error: string | null;
    /** Whether the server holds conversations beyond the loaded page. */
    hasMore: boolean;
    /** Whether a further page is in flight. */
    loadingMore: boolean;
    /** Open a conversation in the chat. */
    onOpen: (conversationId: string) => void;
    /** Fetch the next page. */
    onLoadMore: () => void;
    /** Re-fetch the first page. */
    onRefresh: () => void;
    /** Copy a conversation's opening prompt, flashing the control that asked. */
    onCopy: (conversationId: string, text: string) => void;
    /** The row whose copy control was just used, so it shows a check. */
    copiedId: string | null;
}

/**
 * The conversation list beside the chat.
 *
 * @param props - See {@link IConversationRailProps}.
 * @returns The rail.
 */
export function ConversationRail({
    groups,
    activeConversationId,
    loading,
    error,
    hasMore,
    loadingMore,
    onOpen,
    onLoadMore,
    onRefresh,
    onCopy,
    copiedId
}: IConversationRailProps) {
    const sections = useMemo(() => sectionByDay(groups), [groups]);

    return (
        <aside className={styles.rail} aria-label="Past conversations">
            <div className={styles.rail_header}>
                <span className={styles.rail_title}>
                    <MessageSquare size={16} /> Conversations
                </span>
                <IconButton
                    variant="ghost"
                    size="sm"
                    onClick={onRefresh}
                    disabled={loading}
                    aria-label="Refresh the conversation list"
                    title="Refresh"
                >
                    <RefreshCw size={14} />
                </IconButton>
            </div>

            <div className={styles.rail_body}>
                {error && <div className={styles.rail_note} role="alert">{error}</div>}

                {loading && groups.length === 0 && (
                    <div className={styles.rail_note}>Loading conversations…</div>
                )}

                {!loading && !error && groups.length === 0 && (
                    <div className={styles.rail_note}>No conversations yet. The first one you send appears here.</div>
                )}

                {sections.map(section => (
                    <section key={section.label} className={styles.day}>
                        <h3 className={styles.day_label}>{section.label}</h3>
                        <ul className={styles.list}>
                            {section.groups.map(group => {
                                const isActive = group.conversationId === activeConversationId;
                                return (
                                    <li key={group.conversationId} className={`${styles.row} ${isActive ? styles.row_active : ''}`}>
                                        <button
                                            type="button"
                                            className={styles.row_button}
                                            onClick={() => onOpen(group.conversationId)}
                                            aria-current={isActive ? 'true' : undefined}
                                            title={group.firstPrompt}
                                        >
                                            <span className={styles.row_title}>{group.firstPrompt}</span>
                                            <span className={styles.row_meta}>
                                                <ClientTime date={group.lastAt} format="time" />
                                                <span>· {group.turns} turn{group.turns === 1 ? '' : 's'}</span>
                                                {group.mode === 'scheduled' && <Badge tone="info">Scheduled</Badge>}
                                                {group.status === 'failed' && (
                                                    // The reason rides along as a tooltip so the common
                                                    // case — reading why last night's scheduled run died —
                                                    // costs a hover rather than an open.
                                                    <Badge tone="danger" title={group.errorMessage ?? undefined}>Failed</Badge>
                                                )}
                                                {group.status === 'incomplete' && (
                                                    <Badge tone="warning" title={group.errorMessage ?? undefined}>
                                                        {INCOMPLETE_OUTCOME_LABELS[group.outcome ?? 'empty'] ?? 'No answer'}
                                                    </Badge>
                                                )}
                                                <span
                                                    className={styles.row_cost}
                                                    title="Estimated cost across this conversation's loaded turns, at the provider's per-model rates."
                                                >
                                                    {formatUsd(group.costUsd)}
                                                </span>
                                            </span>
                                        </button>
                                        <IconButton
                                            variant="ghost"
                                            size="xs"
                                            className={styles.row_copy}
                                            onClick={() => onCopy(group.conversationId, group.firstPrompt)}
                                            aria-label="Copy the opening prompt to clipboard"
                                            title="Copy opening prompt"
                                        >
                                            {copiedId === group.conversationId ? <CheckCircle size={14} /> : <Copy size={14} />}
                                        </IconButton>
                                    </li>
                                );
                            })}
                        </ul>
                    </section>
                ))}

                {hasMore && (
                    <Button
                        variant="ghost"
                        size="xs"
                        className={styles.load_more}
                        onClick={onLoadMore}
                        loading={loadingMore}
                    >
                        Load more
                    </Button>
                )}
            </div>
        </aside>
    );
}
