'use client';

/**
 * @fileoverview Management table for address tags: search, create, inline
 * rename, and delete over the admin API client.
 *
 * A thin UI over the central AddressTagService — every action maps 1:1 to a
 * service method through `/api/admin/system/address-tags/*`. Like every other
 * /system manager, it fetches its own admin endpoint on mount rather than
 * SSR-seeding: the SSR + Live Updates mandate covers public-facing content,
 * and admin surfaces are exempt by the /system dashboard convention. The
 * surrounding /system layout gates access for UX while the backend
 * `requireAdmin` middleware is the trust boundary.
 *
 * Pagination deliberately derives its offset from the number of rows already
 * on screen instead of a running counter. A counter drifts the moment a row is
 * deleted locally, silently skipping as many server rows as were removed; the
 * fetched prefix length cannot drift because only fetched rows are deletable.
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
    invalidateAddressTags,
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
    const [committedSearch, setCommittedSearch] = useState('');
    const [loading, setLoading] = useState(true);
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
     * one extra row so "Load more" only shows when a next page exists. A fresh
     * (non-append) load commits `nextSearch` so "Load more" paginates the query
     * that produced the visible rows rather than the live draft input,
     * preventing two unrelated result sets from being mixed. Clearing `loading`
     * in `finally` retires the first-fetch placeholder even when the request
     * fails, so a failed initial load falls through to the empty state rather
     * than spinning forever.
     *
     * @param nextSearch - Query to run; committed as the pagination anchor on a
     *                     non-append load so later pages cannot drift onto a
     *                     different, unsubmitted filter.
     * @param nextSkip - Offset to request. Callers derive this from
     *                   `items.length` rather than a running counter so deleted
     *                   rows cannot desynchronise the next page.
     * @param append - True to extend the visible page ("Load more"), false to
     *                 replace it (initial load, search, post-mutation refresh).
     */
    const load = useCallback(async (nextSearch: string, nextSkip: number, append: boolean) => {
        try {
            const page = await searchTags({ search: nextSearch || undefined, limit: PAGE_SIZE + 1, skip: nextSkip });
            const visible = page.slice(0, PAGE_SIZE);
            setHasMore(page.length > PAGE_SIZE);
            setItems((current) => (append ? [...current, ...visible] : visible));
            if (!append) {
                setCommittedSearch(nextSearch);
            }
        } catch (error) {
            notify('danger', 'Failed to load address tags', error);
        } finally {
            setLoading(false);
        }
    }, [notify]);

    useEffect(() => {
        void load('', 0, false);
    }, [load]);

    /**
     * Re-run the search from offset zero — triggered by the search form.
     */
    const runSearch = useCallback(async () => {
        await load(search, 0, false);
    }, [load, search]);

    /**
     * Create assignments from the form: one address, comma-separated tags.
     * Refreshes from the committed query rather than the live input so adding a
     * tag cannot silently swap the table onto a filter the admin never
     * submitted — which would hide the row they just created.
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
            // Every address chip on the page reads its tooltip tags from the
            // shared module cache, which only re-reads on invalidation — without
            // this, they keep their pre-mutation list for the rest of the session.
            invalidateAddressTags(address);
            notify('success', `Added ${tags.length} tag${tags.length > 1 ? 's' : ''}`);
            setNewAddress('');
            setNewTags('');
            await load(committedSearch, 0, false);
        } catch (error) {
            notify('danger', 'Failed to create tags', error);
        } finally {
            setCreating(false);
        }
    }, [committedSearch, load, newAddress, newTags, notify]);

    /**
     * Commit an inline rename for the row being edited. Refreshes from the
     * committed query for the same reason as creation: the renamed row must
     * stay visible under the filter the admin is actually looking at.
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
            invalidateAddressTags(item.address);
            notify('success', `Renamed '${item.tag}' to '${newTag}'`);
            setEditKey(null);
            await load(committedSearch, 0, false);
        } catch (error) {
            notify('danger', 'Failed to rename tag', error);
        } finally {
            setBusyKey(null);
        }
    }, [committedSearch, editValue, load, notify]);

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
                            invalidateAddressTags(item.address);
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
                        <div className={styles.placeholder}>
                            {loading ? 'Loading address tags…' : 'No address tags found.'}
                        </div>
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
                            onClick={() => void load(committedSearch, items.length, true)}
                        >
                            Load more
                        </Button>
                    )}
                </Stack>
            </Card>
        </Stack>
    );
}
