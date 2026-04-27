'use client';

/**
 * Modal body that lets an admin replace a user's complete group membership.
 *
 * Loads the catalog of group definitions on mount, pre-checks the user's
 * current memberships, and on save calls `PUT /api/admin/users/:id/groups`.
 * The server is authoritative for "set" semantics — the form simply ships
 * the ticked ids and trusts the response. Error states surface as toasts
 * via the caller's `onSubmit` handler.
 *
 * Pattern: client-only admin tool. SSR + Live Updates does not apply here
 * because `/system/users` is admin-gated. Mirrors the established approach
 * in `GroupForm.tsx`.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Lock } from 'lucide-react';
import { config as runtimeConfig } from '../../../../../lib/config';
import { Button } from '../../../../../components/ui/Button';
import styles from './UserGroupsForm.module.scss';

interface UserGroup {
    id: string;
    name: string;
    description: string;
    system: boolean;
}

interface ListResponse {
    groups: UserGroup[];
}

interface Props {
    token: string;
    userId: string;
    initialGroups: string[];
    onCancel: () => void;
    onSubmit: (selectedGroupIds: string[]) => void | Promise<void>;
}

export function UserGroupsForm({ token, userId, initialGroups, onCancel, onSubmit }: Props) {
    const [groups, setGroups] = useState<UserGroup[]>([]);
    const [selected, setSelected] = useState<Set<string>>(() => new Set(initialGroups));
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [submitting, setSubmitting] = useState(false);

    const baseUrl = useMemo(
        () => `${runtimeConfig.apiBaseUrl}/admin/users/groups`,
        []
    );

    useEffect(() => {
        let cancelled = false;
        async function load() {
            setLoading(true);
            setError(null);
            try {
                const response = await fetch(baseUrl, {
                    headers: { 'X-Admin-Token': token }
                });
                if (!response.ok) {
                    throw new Error(`Failed to load groups (${response.status})`);
                }
                const data: ListResponse = await response.json();
                if (!cancelled) setGroups(data.groups);
            } catch (err) {
                if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load groups');
            } finally {
                if (!cancelled) setLoading(false);
            }
        }
        void load();
        return () => { cancelled = true; };
    }, [baseUrl, token]);

    const toggle = useCallback((groupId: string) => {
        setSelected(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    }, []);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await onSubmit(Array.from(selected));
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className={styles.form}>
            <p className={styles.user_id}>
                User: <code>{userId}</code>
            </p>

            {error && <p className={styles.error}>{error}</p>}

            {loading && <p>Loading groups…</p>}

            {!loading && !error && groups.length === 0 && (
                <p className={styles.empty}>
                    No groups defined yet. Create one in the Groups tab first.
                </p>
            )}

            {!loading && !error && groups.length > 0 && (
                <ul className={styles.group_list}>
                    {groups.map(group => {
                        const checked = selected.has(group.id);
                        return (
                            <li key={group.id} className={styles.group_item}>
                                <label className={styles.group_label}>
                                    <input
                                        type="checkbox"
                                        checked={checked}
                                        onChange={() => toggle(group.id)}
                                        disabled={submitting}
                                    />
                                    <span className={styles.group_text}>
                                        <span className={styles.group_name}>
                                            <code className={styles.group_slug}>{group.id}</code>
                                            {group.system && (
                                                <span
                                                    className="badge badge--info"
                                                    title="System group"
                                                >
                                                    <Lock size={12} aria-hidden="true" /> system
                                                </span>
                                            )}
                                        </span>
                                        {group.description && (
                                            <span className={styles.group_description}>
                                                {group.description}
                                            </span>
                                        )}
                                    </span>
                                </label>
                            </li>
                        );
                    })}
                </ul>
            )}

            <div className={styles.actions}>
                <Button
                    type="button"
                    variant="ghost"
                    onClick={onCancel}
                    disabled={submitting}
                >
                    Cancel
                </Button>
                <Button
                    type="submit"
                    variant="primary"
                    disabled={submitting || loading || !!error}
                >
                    {submitting ? 'Saving…' : 'Save'}
                </Button>
            </div>
        </form>
    );
}
