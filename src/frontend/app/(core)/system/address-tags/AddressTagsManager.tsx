'use client';

/**
 * @fileoverview Management table for address tags: search, create, inline
 * rename, and delete over the admin API client.
 *
 * A thin UI over the central AddressTagService — every action maps 1:1 to a
 * service method through `/api/admin/system/address-tags/*`. Loading states
 * appear only for user-triggered actions and search (permitted by the SSR +
 * Live Updates rules for admin action surfaces); the surrounding /system
 * layout gates access for UX while the backend `requireAdmin` middleware is
 * the trust boundary.
 */

import { useCallback, useEffect, useState } from 'react';
import { Plus, Pencil, Trash2, Check, X, Search } from 'lucide-react';
import { Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../components/ui/Table';
import { ClientTime } from '../../../../components/ui/ClientTime';
import { TronAddress } from '../../../../components/ui/TronAddress';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useModal } from '../../../../components/ui/ModalProvider';
import {
    createTags,
    deleteTags,
    searchTags,
    updateTags,
    type IAddressTagView
} from '../../../../modules/address-tags';
import styles from './page.module.scss';

const PAGE_SIZE = 50;

/**
 * Stable identity for one assignment row, used for edit/busy state keys.
 *
 * @param item - The assignment the key identifies.
 * @returns A unique `address tag` composite key.
 */
function rowKey(item: { address: string; tag: string }): string {
    return `${item.address} ${item.tag}`;
}

/**
 * The full management surface: search bar, create form, and the paged
 * assignment table with inline rename and confirmed delete.
 */
export function AddressTagsManager() {
    const [items, setItems] = useState<IAddressTagView[]>([]);
    const [search, setSearch] = useState('');
    const [skip, setSkip] = useState(0);
    const [hasMore, setHasMore] = useState(false);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [editKey, setEditKey] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    const [newAddress, setNewAddress] = useState('');
    const [newTags, setNewTags] = useState('');
    const [creating, setCreating] = useState(false);
    const { push } = useToast();
    const { open, close } = useModal();

    /**
     * Toast helper mapping a thrown error (or success text) onto the toast
     * provider's `{ tone, title, description }` shape.
     */
    const notify = useCallback((tone: 'success' | 'danger', title: string, error?: unknown) => {
        push({
            tone,
            title,
            description: error ? (error instanceof Error ? error.message : String(error)) : undefined
        });
    }, [push]);

    /**
     * Load one page of assignments for the current search/offset. Requests
     * one extra row so "Load more" only shows when a next page exists.
     */
    const load = useCallback(async (nextSearch: string, nextSkip: number, append: boolean) => {
        try {
            const page = await searchTags({ search: nextSearch || undefined, limit: PAGE_SIZE + 1, skip: nextSkip });
            const visible = page.slice(0, PAGE_SIZE);
            setHasMore(page.length > PAGE_SIZE);
            setItems((current) => (append ? [...current, ...visible] : visible));
        } catch (error) {
            notify('danger', 'Failed to load address tags', error);
        }
    }, [notify]);

    useEffect(() => {
        void load('', 0, false);
    }, [load]);

    /**
     * Re-run the search from offset zero — triggered by the search form.
     */
    const runSearch = useCallback(async () => {
        setSkip(0);
        await load(search, 0, false);
    }, [load, search]);

    /**
     * Create assignments from the form: one address, comma-separated tags.
     */
    const handleCreate = useCallback(async () => {
        const address = newAddress.trim();
        const tags = newTags.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        if (!address || tags.length === 0) {
            notify('danger', 'Enter an address and at least one tag');
            return;
        }
        setCreating(true);
        try {
            await createTags(tags.map((tag) => ({ address, tag })));
            notify('success', `Added ${tags.length} tag${tags.length > 1 ? 's' : ''}`);
            setNewAddress('');
            setNewTags('');
            setSkip(0);
            await load(search, 0, false);
        } catch (error) {
            notify('danger', 'Failed to create tags', error);
        } finally {
            setCreating(false);
        }
    }, [load, newAddress, newTags, notify, search]);

    /**
     * Commit an inline rename for the row being edited.
     */
    const handleRename = useCallback(async (item: IAddressTagView) => {
        const newTag = editValue.trim();
        if (!newTag || newTag === item.tag) {
            setEditKey(null);
            return;
        }
        setBusyKey(rowKey(item));
        try {
            await updateTags([{ address: item.address, oldTag: item.tag, newTag }]);
            notify('success', `Renamed '${item.tag}' to '${newTag}'`);
            setEditKey(null);
            setSkip(0);
            await load(search, 0, false);
        } catch (error) {
            notify('danger', 'Failed to rename tag', error);
        } finally {
            setBusyKey(null);
        }
    }, [editValue, load, notify, search]);

    /**
     * Delete one assignment after modal confirmation.
     */
    const handleDelete = useCallback((item: IAddressTagView) => {
        const modalId = `address-tag-delete-${rowKey(item)}`;
        open({
            id: modalId,
            title: 'Delete address tag',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={`tag '${item.tag}'`}
                    message={`Remove tag '${item.tag}' from ${item.address}?`}
                    onCancel={() => close(modalId)}
                    onConfirm={async () => {
                        try {
                            await deleteTags([{ address: item.address, tag: item.tag }]);
                            notify('success', `Removed '${item.tag}'`);
                            setItems((current) => current.filter((row) => rowKey(row) !== rowKey(item)));
                        } catch (error) {
                            notify('danger', 'Failed to delete tag', error);
                        } finally {
                            close(modalId);
                        }
                    }}
                />
            )
        });
    }, [close, notify, open]);

    return (
        <Stack gap="lg">
            <Card>
                <div className={styles.create_form}>
                    <Input
                        value={newAddress}
                        onChange={(event) => setNewAddress(event.target.value)}
                        placeholder="TRON address (T…)"
                        aria-label="TRON address"
                        className={styles.address_input}
                    />
                    <Input
                        value={newTags}
                        onChange={(event) => setNewTags(event.target.value)}
                        placeholder="Tags (comma-separated)"
                        aria-label="Tags, comma separated"
                        className={styles.tags_input}
                    />
                    <Button variant="primary" onClick={handleCreate} disabled={creating}>
                        <Plus size={18} /> Add tags
                    </Button>
                </div>
            </Card>

            <Card>
                <Stack gap="md">
                    <form
                        className={styles.search_form}
                        onSubmit={(event) => {
                            event.preventDefault();
                            void runSearch();
                        }}
                    >
                        <Input
                            value={search}
                            onChange={(event) => setSearch(event.target.value)}
                            placeholder="Search by address or tag"
                            aria-label="Search address tags"
                            className={styles.search_input}
                        />
                        <Button variant="secondary" type="submit">
                            <Search size={18} /> Search
                        </Button>
                    </form>

                    {items.length === 0 ? (
                        <div className={styles.placeholder}>No address tags found.</div>
                    ) : (
                        <Table className={styles.tags_table}>
                            <Thead>
                                <Tr>
                                    <Th>Address</Th>
                                    <Th>Tag</Th>
                                    <Th>Updated</Th>
                                    <Th>Actions</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {items.map((item) => {
                                    const key = rowKey(item);
                                    const editing = editKey === key;
                                    const busy = busyKey === key;
                                    return (
                                        <Tr key={key}>
                                            <Td data-label="Address">
                                                <TronAddress address={item.address} />
                                            </Td>
                                            <Td data-label="Tag">
                                                {editing ? (
                                                    <Input
                                                        value={editValue}
                                                        onChange={(event) => setEditValue(event.target.value)}
                                                        aria-label={`New name for tag ${item.tag}`}
                                                        size="sm"
                                                        autoFocus
                                                    />
                                                ) : (
                                                    <span className={styles.tag_text}>{item.tag}</span>
                                                )}
                                            </Td>
                                            <Td data-label="Updated">
                                                <ClientTime date={item.updatedAt} format="datetime" />
                                            </Td>
                                            <Td data-label="Actions">
                                                <div className={styles.row_actions}>
                                                    {editing ? (
                                                        <>
                                                            <Button
                                                                variant="primary"
                                                                size="xs"
                                                                onClick={() => void handleRename(item)}
                                                                disabled={busy}
                                                                aria-label="Save rename"
                                                            >
                                                                <Check size={14} />
                                                            </Button>
                                                            <Button
                                                                variant="ghost"
                                                                size="xs"
                                                                onClick={() => setEditKey(null)}
                                                                disabled={busy}
                                                                aria-label="Cancel rename"
                                                            >
                                                                <X size={14} />
                                                            </Button>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Button
                                                                variant="ghost"
                                                                size="xs"
                                                                onClick={() => {
                                                                    setEditKey(key);
                                                                    setEditValue(item.tag);
                                                                }}
                                                                aria-label={`Rename tag ${item.tag}`}
                                                            >
                                                                <Pencil size={14} />
                                                            </Button>
                                                            <Button
                                                                variant="danger"
                                                                size="xs"
                                                                onClick={() => handleDelete(item)}
                                                                aria-label={`Delete tag ${item.tag}`}
                                                            >
                                                                <Trash2 size={14} />
                                                            </Button>
                                                        </>
                                                    )}
                                                </div>
                                            </Td>
                                        </Tr>
                                    );
                                })}
                            </Tbody>
                        </Table>
                    )}

                    {hasMore && (
                        <Button
                            variant="secondary"
                            onClick={() => {
                                const nextSkip = skip + PAGE_SIZE;
                                setSkip(nextSkip);
                                void load(search, nextSkip, true);
                            }}
                        >
                            Load more
                        </Button>
                    )}
                </Stack>
            </Card>
        </Stack>
    );
}
