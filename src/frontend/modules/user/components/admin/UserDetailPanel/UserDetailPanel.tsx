'use client';

/**
 * @fileoverview The per-user detail panel on the Users tab of `/system/users`.
 *
 * It slides in from the right when an admin opens an account, so the account
 * list stays visible behind it. It shows the account, the private admin note,
 * linked wallets, live sessions with the network address and browser of each,
 * connected apps, and the sign-in events naming the account's address, with
 * older events loaded on request.
 *
 * Everything comes from `GET /api/admin/users/:id/details`, which the
 * `identity-get-account` AI tool also reads through, so an admin and an agent
 * looking at the same account see the same facts. The details load when the
 * admin opens an account, so a loading state here is the user-triggered case
 * the SSR + Live Updates pattern allows.
 *
 * Every table fits the 820px panel and stacks its rows into labelled entries
 * only on a phone (`stackAt="mobile"`). The sessions and sign-in events fit
 * because each browser is shown as a short summary such as "Safari 19 ·
 * macOS", with the full User-Agent in the cell's tooltip, the country shares
 * the network address's cell, and a refusal reason, which only a failed event
 * has, sits under that event's badge instead of in a column of dashes.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type { IAccountAdminNote, IAccountSignInEvent } from '@/types';
import { Stack } from '../../../../../components/layout';
import { SlideOver } from '../../../../../components/ui/SlideOver';
import { Panel } from '../../../../../components/ui/Panel';
import { FigureList } from '../../../../../components/ui/FigureList';
import { Badge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { CopyButton } from '../../../../../components/ui/CopyButton';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Skeleton } from '../../../../../components/ui/Skeleton';
import { TronAddress } from '../../../../../components/ui/TronAddress';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import {
    fetchAccountDetails,
    fetchAccountSignInEvents,
    type IAccountDetailsResponse
} from '../../../api/admin-accounts.api';
import { AccountNoteEditor } from './AccountNoteEditor';
import { summarizeUserAgent } from './summarizeUserAgent';
import styles from './UserDetailPanel.module.scss';

/** Sign-in events loaded per "Show more" click. */
const EVENT_PAGE_SIZE = 20;

/**
 * Sign-in events shown when an account opens. The details response carries
 * up to 20, but the newest few answer most questions, and the rest are one
 * "Show older events" click away.
 */
const FIRST_EVENT_COUNT = 10;

/** Badge tone and wording for each sign-in event kind. */
const EVENT_KINDS: Record<string, { tone: 'success' | 'danger' | 'warning' | 'neutral'; label: string }> = {
    'sign-in-succeeded': { tone: 'success', label: 'Signed in' },
    'sign-in-failed': { tone: 'danger', label: 'Sign-in failed' },
    'code-request-failed': { tone: 'warning', label: 'Code refused' },
    'code-sent': { tone: 'neutral', label: 'Code sent' }
};

/** Props for the detail panel. */
interface IUserDetailPanelProps {
    /** The account to show, or null to keep the panel closed. */
    userId: string | null;

    /** Closes the panel; the parent clears its selection. */
    onClose: () => void;
}

/**
 * Render a value or a muted dash when it is empty.
 *
 * @param value - The text to show.
 * @returns The text, or a dash.
 */
function orDash(value: string | null | undefined) {
    return value ? value : <span className="text-muted">—</span>;
}

/**
 * Render a User-Agent as its short summary, with the full string in the
 * tooltip so an admin checking a suspicious session can still read all of it.
 *
 * @param userAgent - The stored User-Agent, or null when the request sent none.
 * @returns The summary, or a dash.
 */
function browserCell(userAgent: string | null | undefined) {
    const summary = summarizeUserAgent(userAgent);
    return summary ? <span title={userAgent ?? undefined}>{summary}</span> : orDash(null);
}

/**
 * Render a network address with the country it was seen from, so the two
 * facts an admin reads together share one cell.
 *
 * @param ip - The caller's address, or null when none was recorded.
 * @param country - The Cloudflare country code, or null.
 * @returns The address, followed by the country when there is one.
 */
function addressCell(ip: string | null | undefined, country?: string | null) {
    return (
        <>
            <code className={styles.mono}>{orDash(ip)}</code>
            {country && <span className="text-muted"> · {country}</span>}
        </>
    );
}

/**
 * The slide-over detail view of one account.
 *
 * @param props - The selected account id and the close callback.
 * @returns The slide-over, closed while no account is selected.
 */
export function UserDetailPanel({ userId, onClose }: IUserDetailPanelProps) {
    const [details, setDetails] = useState<IAccountDetailsResponse | null>(null);
    const [events, setEvents] = useState<IAccountSignInEvent[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [loadingMore, setLoadingMore] = useState(false);

    // The account the panel is showing right now. A pagination request reads it
    // after its await to tell whether the admin is still on the account it was
    // asked for, which the captured `userId` of its own closure cannot say.
    const selectionRef = useRef<string | null>(userId);

    // Load the selected account. A later selection supersedes an earlier one
    // still in flight, so a slow answer never paints over the account the
    // admin moved on to.
    useEffect(() => {
        let current = true;
        selectionRef.current = userId;
        setDetails(null);
        setEvents([]);
        setError(null);
        setLoadingMore(false);
        if (userId) {
            fetchAccountDetails(userId)
                .then(loaded => {
                    if (current) {
                        setDetails(loaded);
                        setEvents(loaded.recentSignInEvents.slice(0, FIRST_EVENT_COUNT));
                    }
                })
                .catch((caught: unknown) => {
                    if (current) {
                        setError(caught instanceof Error ? caught.message : String(caught));
                    }
                });
        }
        return () => {
            current = false;
        };
    }, [userId]);

    /** Keep the panel's copy of the note in step with what the editor saved. */
    const handleNoteSaved = useCallback((adminNote: IAccountAdminNote | null) => {
        setDetails(previous => (previous ? { ...previous, adminNote } : previous));
    }, []);

    /**
     * Append the next page of older sign-in events.
     *
     * The panel stays mounted while the admin moves between accounts, so a page
     * that answers after the selection changed must be dropped. Appending it
     * would credit one account's sign-in activity to another and leave the next
     * offset counting rows the list does not hold.
     */
    const handleShowMore = useCallback(async () => {
        if (userId) {
            setLoadingMore(true);
            try {
                const page = await fetchAccountSignInEvents(userId, { limit: EVENT_PAGE_SIZE, offset: events.length });
                if (selectionRef.current === userId) {
                    setEvents(previous => [...previous, ...page.events]);
                }
            } catch (caught: unknown) {
                if (selectionRef.current === userId) {
                    setError(caught instanceof Error ? caught.message : String(caught));
                }
            } finally {
                if (selectionRef.current === userId) {
                    setLoadingMore(false);
                }
            }
        }
    }, [events.length, userId]);

    const account = details?.account;

    return (
        <SlideOver
            open={userId !== null}
            onClose={onClose}
            width="lg"
            title={account?.email ?? 'Account'}
            label="Account details"
        >
            {error && <div className="alert" role="alert">{error}</div>}
            {!details && !error && (
                <Stack gap="sm" aria-busy="true">
                    <Skeleton style={{ height: '6rem' }} />
                    <Skeleton style={{ height: '8rem' }} />
                    <Skeleton style={{ height: '8rem' }} />
                </Stack>
            )}
            {details && account && (
                <Stack gap="md" className={styles.panel_body}>
                    <Panel titleAs="h3" title="Account" actions={<CopyButton value={account.id} label="Copy id" size="xs" variant="ghost" />}>
                        <FigureList
                            label="Account"
                            rows={[
                                { key: 'name', label: 'Name', value: orDash(account.name) },
                                { key: 'id', label: 'Account id', value: <code className={styles.mono}>{account.id}</code> },
                                {
                                    key: 'status',
                                    label: 'Status',
                                    value: account.deletedAt
                                        ? <Badge tone="danger" size="sm">Deleted</Badge>
                                        : account.emailVerified
                                            ? <Badge tone="success" size="sm">Verified</Badge>
                                            : <Badge tone="neutral" size="sm">Unverified</Badge>
                                },
                                {
                                    key: 'groups',
                                    label: 'Groups',
                                    value: account.groups.length === 0
                                        ? orDash(null)
                                        : <span className={styles.chips}>{account.groups.map(group => <Badge key={group} tone="info" size="sm"><code>{group}</code></Badge>)}</span>
                                },
                                { key: 'created', label: 'Created', value: <ClientTime date={account.createdAt} format="short" /> },
                                {
                                    key: 'seen',
                                    label: 'Last seen',
                                    value: account.lastSeenAt ? <ClientTime date={account.lastSeenAt} format="short" /> : 'Never',
                                    note: 'Last signed-in request or MCP call, to within five minutes.'
                                },
                                ...(account.deletedAt
                                    ? [{ key: 'deleted', label: 'Deleted', value: <ClientTime date={account.deletedAt} format="short" /> }]
                                    : [])
                            ]}
                        />
                    </Panel>

                    <Panel titleAs="h3" title="Admin note" meta="Private to administrators">
                        <AccountNoteEditor key={account.id} userId={account.id} initialNote={details.adminNote} onSaved={handleNoteSaved} />
                    </Panel>

                    <Panel titleAs="h3" title="Wallets" meta={`${details.wallets.length} linked`}>
                        {details.wallets.length === 0 ? (
                            <p className="text-muted">No wallets linked.</p>
                        ) : (
                            <Table variant="compact" flush stackAt="mobile">
                                <Thead>
                                    <Tr><Th>Address</Th><Th>Primary</Th><Th>Linked</Th><Th>Last used</Th></Tr>
                                </Thead>
                                <Tbody>
                                    {details.wallets.map(wallet => (
                                        <Tr key={wallet.address}>
                                            <Td><TronAddress address={wallet.address} /></Td>
                                            <Td label="Primary">{wallet.isPrimary ? <Badge tone="success" size="sm">Primary</Badge> : orDash(null)}</Td>
                                            <Td label="Linked"><ClientTime date={wallet.linkedAt} format="short" /></Td>
                                            <Td label="Last used"><ClientTime date={wallet.lastUsedAt} format="short" /></Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        )}
                    </Panel>

                    <Panel
                        titleAs="h3"
                        title="Sessions"
                        meta={`${details.sessions.length}${details.sessionsTruncated ? '+' : ''} live · an unfamiliar one can mean a takeover`}
                    >
                        {details.sessions.length === 0 ? (
                            <p className="text-muted">No live sessions.</p>
                        ) : (
                            <Table variant="compact" flush stackAt="mobile">
                                <Thead>
                                    <Tr><Th>Signed in</Th><Th>Refreshed</Th><Th>Expires</Th><Th>Network address</Th><Th>Browser</Th></Tr>
                                </Thead>
                                <Tbody>
                                    {details.sessions.map(session => (
                                        <Tr key={session.id}>
                                            <Td label="Signed in">{session.createdAt ? <ClientTime date={session.createdAt} format="short" /> : orDash(null)}</Td>
                                            <Td label="Refreshed">{session.updatedAt ? <ClientTime date={session.updatedAt} format="relative" /> : orDash(null)}</Td>
                                            <Td label="Expires">{session.expiresAt ? <ClientTime date={session.expiresAt} format="relative" /> : orDash(null)}</Td>
                                            <Td label="Network address">{addressCell(session.ipAddress)}</Td>
                                            <Td label="Browser">{browserCell(session.userAgent)}</Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        )}
                    </Panel>

                    <Panel titleAs="h3" title="Connected apps" meta={`${details.connectedApps.length} connected`}>
                        {details.connectedApps.length === 0 ? (
                            <p className="text-muted">No apps connected.</p>
                        ) : (
                            <Table variant="compact" flush stackAt="mobile">
                                <Thead>
                                    <Tr><Th>App</Th><Th>Redirects to</Th><Th>Connected</Th><Th>Last used</Th></Tr>
                                </Thead>
                                <Tbody>
                                    {details.connectedApps.map(app => (
                                        <Tr key={app.clientId}>
                                            <Td>{app.clientName}{app.loopbackOnly && <> <Badge tone="warning" size="sm">Local only</Badge></>}</Td>
                                            <Td label="Redirects to" stackSpan={2}><span className={styles.long_text}>{app.redirectHosts.join(', ') || '—'}</span></Td>
                                            <Td label="Connected"><ClientTime date={app.grantedAt} format="short" /></Td>
                                            <Td label="Last used">{app.lastUsedAt ? <ClientTime date={app.lastUsedAt} format="short" /> : orDash(null)}</Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        )}
                    </Panel>

                    <Panel
                        titleAs="h3"
                        title="Sign-in events"
                        meta={`${details.signInEventsTotal.toLocaleString('en-US')} in 90 days · matched by email, so others' attempts show too`}
                        actions={events.length < details.signInEventsTotal && (
                            // In the header rather than under the list, so the
                            // table stays the last thing in the panel and runs
                            // to its edges.
                            <Button variant="ghost" loading={loadingMore} onClick={() => void handleShowMore()}>
                                Show older ({(details.signInEventsTotal - events.length).toLocaleString('en-US')} more)
                            </Button>
                        )}
                    >
                        {events.length === 0 ? (
                            <p className="text-muted">No sign-in events recorded for this address.</p>
                        ) : (
                            <Table variant="compact" flush stackAt="mobile">
                                <Thead>
                                    <Tr><Th>When</Th><Th>Event</Th><Th>Method</Th><Th>Network address</Th><Th>Browser</Th></Tr>
                                </Thead>
                                <Tbody>
                                    {events.map((event, index) => {
                                        const kind = EVENT_KINDS[event.kind] ?? { tone: 'neutral' as const, label: event.kind };
                                        return (
                                            <Tr key={`${event.occurredAt}-${index}`}>
                                                <Td label="When"><ClientTime date={event.occurredAt} format="short" /></Td>
                                                <Td label="Event">
                                                    {/* Only a failure has a reason, so it sits under
                                                        the badge rather than in a column that would
                                                        be a dash on every success. */}
                                                    <span className={styles.event}>
                                                        <Badge tone={kind.tone} size="sm" title={event.reason ?? undefined}>{kind.label}</Badge>
                                                        {event.reason && <span className={styles.reason}>{event.reason}</span>}
                                                    </span>
                                                </Td>
                                                <Td label="Method">{orDash(event.method)}</Td>
                                                <Td label="Network address">{addressCell(event.ip, event.country)}</Td>
                                                <Td label="Browser">{browserCell(event.userAgent)}</Td>
                                            </Tr>
                                        );
                                    })}
                                </Tbody>
                            </Table>
                        )}
                    </Panel>
                </Stack>
            )}
        </SlideOver>
    );
}
