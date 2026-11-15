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
 * session-cookie auth, fetch-on-mount, local state. SSR + Live
 * Updates does not apply because the route is admin-gated and not
 * public-facing. Modal lifecycle goes through the shared `useModal`
 * provider rather than a hand-rolled portal.
 *
 * The list is the shared Table with `stackAt="mobile"`: its five columns fit a
 * tablet, and on a phone each group becomes a labelled entry headed by its id,
 * so no column has to be hidden to make the rest fit.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Plus, Pencil, Trash2, Lock, Users as UsersIcon } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Card } from '../../../../../components/ui/Card';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { GroupForm, type GroupFormValues } from './GroupForm';
import { GroupMembersList } from './GroupMembersList';
import styles from './GroupsManager.module.scss';

/** One user group as the list endpoint sends it. */
interface IUserGroup {
    id: string;
    name: string;
    description: string;
    system: boolean;
    createdAt: string;
    updatedAt: string;
}

/** The body of `GET /api/admin/users/groups`. */
interface IListResponse {
    groups: IUserGroup[];
}

/**
 * The Groups tab: lists every user group and opens the create, edit, members,
 * and delete flows for each.
 *
 * @returns The tab content.
 */
export function GroupsManager() {
    const [groups, setGroups] = useState<IUserGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [fetchError, setFetchError] = useState<string | null>(null);

    const { open: openModal, close: closeModal } = useModal();
    const { push: pushToast } = useToast();

    const baseUrl = useMemo(
        () => `/api/admin/users/groups`,
        []
    );

    /** Load the group list, keeping the failure on screen with a retry. */
    const fetchGroups = useCallback(async () => {
        setLoading(true);
        setFetchError(null);
        try {
            const response = await fetch(baseUrl);
            if (!response.ok) {
                throw new Error(`Failed to load groups (${response.status})`);
            }
            const data: IListResponse = await response.json();
            setGroups(data.groups);
        } catch (error) {
            setFetchError(error instanceof Error ? error.message : 'Failed to load groups');
        } finally {
            setLoading(false);
        }
    }, [baseUrl]);

    /** Load the list when the tab opens. */
    useEffect(() => {
        void fetchGroups();
    }, [fetchGroups]);

    /**
     * Create a group, throwing the server's message so the modal can show it.
     *
     * @param values - The new group's id, name, and description.
     */
    const submitCreate = useCallback(async (values: GroupFormValues) => {
        const response = await fetch(baseUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values)
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.message ?? `Request failed (${response.status})`);
        }
    }, [baseUrl]);

    /**
     * Rename or redescribe a group; its id is fixed once created.
     *
     * @param id - The group to change.
     * @param values - The new name and description.
     */
    const submitUpdate = useCallback(async (id: string, values: Pick<GroupFormValues, 'name' | 'description'>) => {
        const response = await fetch(`${baseUrl}/${encodeURIComponent(id)}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(values)
        });
        if (!response.ok) {
            const payload = await response.json().catch(() => null);
            throw new Error(payload?.message ?? `Request failed (${response.status})`);
        }
    }, [baseUrl]);

    /** Open the create form; a save closes it and reloads the list. */
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

    /**
     * Show who belongs to a group, read-only.
     *
     * @param group - The group whose members to list.
     */
    const openMembersModal = useCallback((group: IUserGroup) => {
        const id = openModal({
            title: `Members of "${group.id}"`,
            size: 'sm',
            content: (
                <GroupMembersList
                    groupId={group.id}
                    groupName={group.name}
                    onClose={() => closeModal(id)}
                />
            )
        });
    }, [openModal, closeModal]);

    /**
     * Open the edit form for an admin-defined group.
     *
     * @param group - The group to edit.
     */
    const openEditModal = useCallback((group: IUserGroup) => {
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

    /**
     * Confirm, then delete a group, which also removes it from every member.
     *
     * @param group - The group to delete.
     */
    const deleteGroup = useCallback(async (group: IUserGroup) => {
        const confirmed = window.confirm(
            `Delete group "${group.name}"? Users will lose membership in this group.`
        );
        if (!confirmed) return;

        try {
            const response = await fetch(
                `${baseUrl}/${encodeURIComponent(group.id)}`,
                { method: 'DELETE' }
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
    }, [baseUrl, pushToast, fetchGroups]);

    return (
        <div className={styles.container}>
            <header className={styles.header}>
                <div>
                    {/* h2: the /system/users shell owns the page's single h1. */}
                    <h2 className={styles.title}>User Groups</h2>
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
                <Table stackAt="mobile">
                    <Thead>
                        <Tr>
                            <Th scope="col">ID</Th>
                            <Th scope="col">Name</Th>
                            <Th scope="col">Description</Th>
                            <Th scope="col">Updated</Th>
                            <Th scope="col" width="shrink">Actions</Th>
                        </Tr>
                    </Thead>
                    <Tbody>
                        {groups.map(group => (
                            <Tr key={group.id}>
                                {/* No label: the id is the heading of a stacked entry. */}
                                <Td>
                                    <span className={styles.slug_cell}>
                                        <code className={styles.slug}>{group.id}</code>
                                        {group.system && (
                                            <Badge tone="info" size="sm" title="System group — read-only">
                                                <Lock size={12} aria-hidden="true" /> system
                                            </Badge>
                                        )}
                                    </span>
                                </Td>
                                <Td label="Name">{group.name}</Td>
                                <Td label="Description" stackSpan="full" className={styles.description}>
                                    {group.description || <span className="text-muted">—</span>}
                                </Td>
                                <Td label="Updated">
                                    <ClientTime date={group.updatedAt} format="date" />
                                </Td>
                                <Td label="Actions">
                                    <span className={styles.actions}>
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            onClick={() => openMembersModal(group)}
                                            aria-label={`View members of ${group.name}`}
                                            title="View members"
                                        >
                                            <UsersIcon size={14} aria-hidden="true" />
                                        </Button>
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
                                    </span>
                                </Td>
                            </Tr>
                        ))}
                    </Tbody>
                </Table>
            )}
        </div>
    );
}
