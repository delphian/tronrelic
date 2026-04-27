'use client';

/**
 * Admin tab for managing user groups.
 *
 * Groups are light tags consumed by plugins for permission gating. This
 * tab supports CRUD on admin-defined groups; system rows are shown as
 * read-only with a badge so admins can see what's reserved without being
 * able to mutate the platform-owned namespace.
 *
 * Mirrors the established admin-tab pattern (UsersMonitor): client-only,
 * `X-Admin-Token` header, fetch-on-mount, local state. SSR + Live
 * Updates does not apply because the route is admin-gated and not
 * public-facing. Modal lifecycle goes through the shared `useModal`
 * provider rather than a hand-rolled portal.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Lock } from 'lucide-react';
import { config as runtimeConfig } from '../../../../../lib/config';
import { Button } from '../../../../../components/ui/Button';
import { Card } from '../../../../../components/ui/Card';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { GroupForm, type GroupFormValues } from './GroupForm';
import styles from './GroupsManager.module.scss';

interface UserGroup {
    id: string;
    name: string;
    description: string;
    system: boolean;
    createdAt: string;
    updatedAt: string;
}

interface ListResponse {
    groups: UserGroup[];
}

interface Props {
    token: string;
}

export function GroupsManager({ token }: Props) {
    const [groups, setGroups] = useState<UserGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();

    const baseUrl = useMemo(
        () => `${runtimeConfig.apiBaseUrl}/admin/users/groups`,
        []
    );

    const fetchGroups = useCallback(async () => {
        setLoading(true);
        setFetchError(null);
        try {
            const response = await fetch(baseUrl, {
                headers: { 'X-Admin-Token': token }
            });
            if (!response.ok) {
                throw new Error(`Failed to load groups (${response.status})`);
            }
            const data: ListResponse = await response.json();
            setGroups(data.groups);
        } catch (error) {
            setFetchError(error instanceof Error ? error.message : 'Failed to load groups');
        } finally {
            setLoading(false);
        }
    }, [baseUrl, token]);

    useEffect(() => {
        void fetchGroups();
    }, [fetchGroups]);

    const submitCreate = useCallback(async (values: GroupFormValues) => {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: {
                'X-Admin-Token': token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(values)
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.message ?? `Request failed (${response.status})`);
        }
    }, [baseUrl, token]);

    const submitUpdate = useCallback(async (id: string, values: Pick<GroupFormValues, 'name' | 'description'>) => {
        const response = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: {
                'X-Admin-Token': token,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(values)
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.message ?? `Request failed (${response.status})`);
        }
    }, [baseUrl, token]);

    const openCreateModal = useCallback(() => {
        const id = openModal({
            title: 'Create Group',
            size: 'sm',
            content: (
                <GroupForm
                    mode="create"
                    onCancel={() => closeModal(id)}
                    onSubmit={async (values) => {
                        try {
                            await submitCreate(values);
                            pushToast({ tone: 'success', title: `Group "${values.id}" created` });
                            closeModal(id);
                            await fetchGroups();
                        } catch (error) {
                            pushToast({
                                tone: 'danger',
                                title: error instanceof Error ? error.message : 'Create failed'
                            });
                        }
                    }}
                />
            )
        });
    }, [openModal, closeModal, submitCreate, fetchGroups, pushToast]);

    const openEditModal = useCallback((group: UserGroup) => {
        const id = openModal({
            title: `Edit "${group.id}"`,
            size: 'sm',
            content: (
                <GroupForm
                    mode="edit"
                    initial={group}
                    onCancel={() => closeModal(id)}
                    onSubmit={async (values) => {
                        try {
                            await submitUpdate(group.id, {
                                name: values.name,
                                description: values.description
                            });
                            pushToast({ tone: 'success', title: `Group "${group.id}" updated` });
                            closeModal(id);
                            await fetchGroups();
                        } catch (error) {
                            pushToast({
                                tone: 'danger',
                                title: error instanceof Error ? error.message : 'Update failed'
                            });
                        }
                    }}
                />
            )
        });
    }, [openModal, closeModal, submitUpdate, fetchGroups, pushToast]);

    const deleteGroup = useCallback(async (group: UserGroup) => {
        const confirmed = window.confirm(
            `Delete group "${group.name}"? Users will lose membership in this group.`
        );
        if (!confirmed) return;

        try {
            const response = await fetch(
                `${baseUrl}/${encodeURIComponent(group.id)}`,
                {
                    method: 'DELETE',
                    headers: { 'X-Admin-Token': token }
                }
            );
            if (!response.ok) {
                const payload = await response.json().catch(() => null);
                throw new Error(payload?.message ?? `Delete failed (${response.status})`);
            }
            pushToast({ tone: 'success', title: `Group "${group.id}" deleted` });
            await fetchGroups();
        } catch (error) {
            pushToast({
                tone: 'danger',
                title: error instanceof Error ? error.message : 'Delete failed'
            });
        }
    }, [baseUrl, token, pushToast, fetchGroups]);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    <h1 className={styles.title}>User Groups</h1>
                    <p className={styles.subtitle}>
                        Admin-defined tags that plugins consume for permission
                        controls. System groups are reserved by the platform.
                    </p>
                </div>
                <Button variant="primary" onClick={openCreateModal} aria-label="Create new group">
                    <Plus size={16} aria-hidden="true" /> New Group
                </Button>
            </header>

            {fetchError && (
                <Card padding="md" className={styles.error_card}>
                    <p>{fetchError}</p>
                    <Button variant="secondary" onClick={() => void fetchGroups()}>
                        Retry
                    </Button>
                </Card>
            )}

            {!fetchError && loading && groups.length === 0 && (
                <Card padding="md"><p>Loading groups…</p></Card>
            )}

            {!fetchError && !loading && groups.length === 0 && (
                <Card padding="md">
                    <p>No groups yet. Create one to get started.</p>
                </Card>
            )}

            {groups.length > 0 && (
                <Card padding="sm">
                    <table className={styles.table}>
                        <thead>
                            <tr>
                                <th scope="col">ID</th>
                                <th scope="col">Name</th>
                                <th scope="col">Description</th>
                                <th scope="col">Updated</th>
                                <th scope="col" className={styles.actions_col}>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            {groups.map(group => (
                                <tr key={group.id}>
                                    <td className={styles.slug_cell}>
                                        <code className={styles.slug}>{group.id}</code>
                                        {group.system && (
                                            <span
                                                className="badge badge--info"
                                                title="System group — read-only"
                                            >
                                                <Lock size={12} aria-hidden="true" /> system
                                            </span>
                                        )}
                                    </td>
                                    <td>{group.name}</td>
                                    <td className={styles.description}>
                                        {group.description || <span className="text-muted">—</span>}
                                    </td>
                                    <td>
                                        <ClientTime date={group.updatedAt} format="date" />
                                    </td>
                                    <td className={styles.actions}>
                                        {group.system ? (
                                            <span className="text-muted">Read-only</span>
                                        ) : (
                                            <>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => openEditModal(group)}
                                                    aria-label={`Edit ${group.name}`}
                                                >
                                                    <Pencil size={14} aria-hidden="true" />
                                                </Button>
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => void deleteGroup(group)}
                                                    aria-label={`Delete ${group.name}`}
                                                >
                                                    <Trash2 size={14} aria-hidden="true" />
                                                </Button>
                                            </>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </Card>
            )}
        </div>
    );
}
