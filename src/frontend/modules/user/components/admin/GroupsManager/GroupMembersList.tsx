'use client';

/**
 * Modal body listing the current members of a single group.
 *
 * Read-only audit view — for "promote this user", admins use the editor
 * in `UsersMonitor`. This view exists because finding everyone currently
 * in a particular group (especially `admin`) is the rare-but-important
 * operator question that the per-user editor can't answer cheaply.
 *
 * Pattern: client-only admin tool, mirrors GroupsManager / UserGroupsForm.
 */

import { useEffect, useMemo, useState } from 'react';
import { config as runtimeConfig } from '../../../../../lib/config';
import { Button } from '../../../../../components/ui/Button';
import styles from './GroupMembersList.module.scss';

interface MembersResponse {
    userIds: string[];
    total: number;
}

interface Props {
    token: string;
    groupId: string;
    groupName: string;
    onClose: () => void;
}

const PAGE_SIZE = 100;

export function GroupMembersList({ token, groupId, groupName, onClose }: Props) {
    const [members, setMembers] = useState<string[]>([]);
    const [total, setTotal] = useState(0);
    const [skip, setSkip] = useState(0);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const baseUrl = useMemo(
        () =>
            `${runtimeConfig.apiBaseUrl}/admin/users/groups/${encodeURIComponent(groupId)}/members`,
        [groupId]
    );

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(
                    `${baseUrl}?limit=${PAGE_SIZE}&skip=${skip}`,
                    { headers: { 'X-Admin-Token': token } }
                );
                if (!response.ok) {
                    throw new Error(`Failed to load members (${response.status})`);
                }
                const data: MembersResponse = await response.json();
                if (!cancelled) {
                    setMembers(data.userIds);
                    setTotal(data.total);
                }
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load members');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [baseUrl, token, skip]);

    const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
    const currentPage = Math.floor(skip / PAGE_SIZE) + 1;

    return (
        <div className={styles.container}>
            <p className={styles.summary}>
                <strong>{groupName}</strong> — {total.toLocaleString()} member{total === 1 ? '' : 's'}
            </p>

            {error && <p className={styles.error}>{error}</p>}

            {loading && <p>Loading members…</p>}

            {!loading && !error && members.length === 0 && (
                <p className={styles.empty}>
                    No users belong to this group yet. Assign membership from the Users
                    tab.
                </p>
            )}

            {!loading && !error && members.length > 0 && (
                <ul className={styles.list}>
                    {members.map(id => (
                        <li key={id} className={styles.item}>
                            <code className={styles.user_id}>{id}</code>
                        </li>
                    ))}
                </ul>
            )}

            {total > PAGE_SIZE && (
                <div className={styles.pagination}>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSkip(Math.max(0, skip - PAGE_SIZE))}
                        disabled={skip === 0 || loading}
                    >
                        Previous
                    </Button>
                    <span className={styles.page_info}>
                        Page {currentPage} of {totalPages}
                    </span>
                    <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setSkip(skip + PAGE_SIZE)}
                        disabled={skip + PAGE_SIZE >= total || loading}
                    >
                        Next
                    </Button>
                </div>
            )}

            <div className={styles.actions}>
                <Button type="button" variant="ghost" onClick={onClose}>
                    Close
                </Button>
            </div>
        </div>
    );
}
