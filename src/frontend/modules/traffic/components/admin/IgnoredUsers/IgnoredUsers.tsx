'use client';

/**
 * IgnoredUsers Settings Panel
 *
 * Manages the always-on registered-account ignore list. Ignored accounts are
 * excluded from every stat on the dashboard — whole-person: an account's entire
 * browsing history (including its anonymous, pre-login rows under the same
 * cookie) drops out of all counts.
 *
 * The exclusion is a read-time filter, never a collection-time one: rows are
 * always recorded and retained, so removing an account here restores its full
 * history to every stat immediately. That reversibility is the reason this is an
 * ignore list, not a delete.
 *
 * Admin-only panel — no SSR data fetching; admin pages fetch client-side after
 * auth, so the initial load state here is the permitted admin case.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { isAxiosError } from 'axios';
import { Search, UserX, X } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Card } from '../../../../../components/ui/Card';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Stack } from '../../../../../components/layout';
import {
    adminGetIgnoredUsers,
    adminAddIgnoredUser,
    adminRemoveIgnoredUser,
    adminSearchAccounts
} from '../../../api/client';
import type { IIgnoredUser, IAccountMatch } from '../../../api/client';
import styles from './IgnoredUsers.module.scss';

/** Debounce (ms) before an account search fires as the operator types. */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Extract a human-readable message from a failed request, preferring the
 * server's structured error so the operator sees why an add/remove failed.
 *
 * @param err - The thrown value from an api client call.
 * @param fallback - Default message when nothing more specific is available.
 * @returns The best available message.
 */
function messageFrom(err: unknown, fallback: string): string {
    if (isAxiosError<{ message?: string; error?: string }>(err)) {
        return err.response?.data?.message || err.response?.data?.error || fallback;
    }
    return err instanceof Error ? err.message : fallback;
}

/**
 * Admin panel to view and edit the registered-account ignore list. Searches the
 * account directory (by email/name or exact user id) to add accounts, and lists
 * current entries with a one-click remove.
 *
 * @returns The rendered ignore-list settings card.
 */
export function IgnoredUsers() {
    const [users, setUsers] = useState<IIgnoredUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);

    const [query, setQuery] = useState('');
    const [results, setResults] = useState<IAccountMatch[]>([]);
    const [searching, setSearching] = useState(false);
    const [adding, setAdding] = useState(false);
    // Guards the debounced search against a stale response overwriting a newer
    // one — only the latest issued search may set results.
    const searchSeq = useRef(0);

    useEffect(() => {
        let active = true;
        adminGetIgnoredUsers()
            .then(list => { if (active) setUsers(list); })
            .catch(() => { if (active) setError('Failed to load the ignore list'); })
            .finally(() => { if (active) setLoading(false); });
        return () => { active = false; };
    }, []);

    // Debounced account search. Clears results for a blank/one-char query so the
    // dropdown does not flash on a single keystroke.
    useEffect(() => {
        const term = query.trim();
        if (term.length < 2) {
            setResults([]);
            setSearching(false);
            return;
        }
        setSearching(true);
        const seq = ++searchSeq.current;
        const timer = setTimeout(async () => {
            try {
                const matches = await adminSearchAccounts(term);
                if (seq === searchSeq.current) setResults(matches);
            } catch {
                if (seq === searchSeq.current) setResults([]);
            } finally {
                if (seq === searchSeq.current) setSearching(false);
            }
        }, SEARCH_DEBOUNCE_MS);
        return () => clearTimeout(timer);
    }, [query]);

    /**
     * Add an account to the ignore list, then reset the search box. The server
     * returns the updated list so the panel needs no follow-up fetch.
     *
     * @param userId - Better Auth user id to ignore.
     */
    const handleAdd = useCallback(async (userId: string): Promise<void> => {
        setError(null);
        setAdding(true);
        try {
            setUsers(await adminAddIgnoredUser(userId));
            setQuery('');
            setResults([]);
        } catch (err) {
            setError(messageFrom(err, 'Failed to add account to the ignore list'));
        } finally {
            setAdding(false);
        }
    }, []);

    /**
     * Remove an account from the ignore list; its history returns to every stat
     * at once.
     *
     * @param userId - Better Auth user id to stop ignoring.
     */
    const handleRemove = useCallback(async (userId: string): Promise<void> => {
        setError(null);
        setBusyId(userId);
        try {
            setUsers(await adminRemoveIgnoredUser(userId));
        } catch (err) {
            setError(messageFrom(err, 'Failed to remove account from the ignore list'));
        } finally {
            setBusyId(null);
        }
    }, []);

    const trimmed = query.trim();
    // Offer a raw-id add when the term looks like a Better Auth id but the
    // directory returned no match (e.g. a deleted account) — the id still filters.
    const rawIdOffer = /^[0-9a-f]{24}$/i.test(trimmed)
        && !results.some(r => r.id === trimmed)
        && !users.some(u => u.userId === trimmed);

    return (
        <div className={styles.container}>
            <Card padding="lg">
                <Stack gap="md">
                    <h3>Ignored Registered Users</h3>
                    <p className="text-muted">
                        Accounts on this list are excluded from every stat &mdash; the whole person,
                        including their anonymous browsing before they logged in. Filtering happens at
                        read time and no data is deleted, so removing an account restores its full
                        history to every stat immediately. Use it to keep your own and staff traffic
                        out of the numbers.
                    </p>

                    {error && <div className={styles.error} role="alert">{error}</div>}

                    <div className={styles.search}>
                        <div className={styles.search_input}>
                            <Search size={16} aria-hidden="true" className={styles.search_icon} />
                            <Input
                                type="text"
                                className={styles.search_field}
                                value={query}
                                onChange={e => setQuery(e.target.value)}
                                placeholder="Search accounts by email, name, or paste a user id"
                                aria-label="Search accounts to ignore"
                            />
                        </div>

                        {(results.length > 0 || searching || rawIdOffer) && (
                            <ul className={styles.results} role="listbox" aria-label="Account search results">
                                {searching && <li className={styles.results_note}>Searching…</li>}
                                {!searching && results.map(a => (
                                    <li key={a.id}>
                                        <button
                                            type="button"
                                            className={styles.result}
                                            onClick={() => handleAdd(a.id)}
                                            disabled={adding || users.some(u => u.userId === a.id)}
                                        >
                                            <span className={styles.result_email}>{a.email || '(no email)'}</span>
                                            {a.name && <span className={styles.result_name}>{a.name}</span>}
                                            {users.some(u => u.userId === a.id) && (
                                                <span className={styles.result_already}>already ignored</span>
                                            )}
                                        </button>
                                    </li>
                                ))}
                                {!searching && rawIdOffer && (
                                    <li>
                                        <button
                                            type="button"
                                            className={styles.result}
                                            onClick={() => handleAdd(trimmed)}
                                            disabled={adding}
                                        >
                                            <span className={styles.result_email}>Ignore user id {trimmed}</span>
                                            <span className={styles.result_name}>no directory match — id still filters</span>
                                        </button>
                                    </li>
                                )}
                                {!searching && results.length === 0 && !rawIdOffer && (
                                    <li className={styles.results_note}>No matching accounts.</li>
                                )}
                            </ul>
                        )}
                    </div>

                    {loading ? (
                        <p className="text-muted">Loading the ignore list…</p>
                    ) : users.length === 0 ? (
                        <p className={styles.empty}>No accounts are ignored. Every registered user counts in the stats.</p>
                    ) : (
                        <ul className={styles.list}>
                            {users.map(u => (
                                <li key={u.userId} className={styles.item}>
                                    <span className={styles.item_icon}><UserX size={16} aria-hidden="true" /></span>
                                    <span className={styles.item_main}>
                                        <span className={styles.item_email}>{u.email || u.userId}</span>
                                        {u.name && <span className={styles.item_name}>{u.name}</span>}
                                    </span>
                                    <span className={styles.item_added}>
                                        <ClientTime date={u.addedAt} format="date" />
                                    </span>
                                    <Button
                                        type="button"
                                        size="xs"
                                        variant="ghost"
                                        onClick={() => handleRemove(u.userId)}
                                        loading={busyId === u.userId}
                                        aria-label={`Stop ignoring ${u.email || u.userId}`}
                                    >
                                        <X size={14} aria-hidden="true" /> Remove
                                    </Button>
                                </li>
                            ))}
                        </ul>
                    )}
                </Stack>
            </Card>
        </div>
    );
}
