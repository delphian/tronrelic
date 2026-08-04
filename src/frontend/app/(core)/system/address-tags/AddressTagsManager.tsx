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
 * One row is one *address*, listing every tag attached to it. That grouping is
 * done server-side by `searchAddresses` rather than here, because paging has to
 * advance by address: grouping a page of flat assignments locally would split
 * any address whose tags straddle the page boundary, rendering it as two rows
 * with partial tag lists.
 *
 * Pagination deliberately derives its offset from the number of rows already
 * on screen instead of a running counter. A counter drifts the moment a row is
 * removed locally, silently skipping as many server rows as were removed; the
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
import { AddressSelector } from '../../../../components/ui/AddressSelector';
import { ConfirmDialog } from '../../../../components/ui/ConfirmDialog';
import { useToast } from '../../../../components/ui/ToastProvider';
import { useModal } from '../../../../components/ui/ModalProvider';
import {
    createTags,
    deleteTags,
    invalidateAddressTags,
    searchAddresses,
    updateTags,
    type IAddressTagGroupView,
    type IAddressTagView
} from '../../../../modules/address-tags';
import styles from './page.module.scss';

const PAGE_SIZE = 50;

/**
 * Stable identity for one assignment, used for edit and busy state keys. Rows
 * are addresses, but those two states still track a single tag: an admin
 * renames one tag at a time even when its row holds a dozen.
 *
 * @param item - The assignment the key identifies.
 * @returns A unique `address tag` composite key.
 */
function tagKey(item: { address: string; tag: string }): string {
    return `${item.address} ${item.tag}`;
}

/**
 * The full management surface: create form, search bar, and the paged table of
 * tagged addresses with per-tag inline rename and confirmed delete.
 */
export function AddressTagsManager() {
    const [groups, setGroups] = useState<IAddressTagGroupView[]>([]);
    const [search, setSearch] = useState('');
    const [committedSearch, setCommittedSearch] = useState('');
    const [loading, setLoading] = useState(true);
    const [hasMore, setHasMore] = useState(false);
    const [busyKey, setBusyKey] = useState<string | null>(null);
    const [editKey, setEditKey] = useState<string | null>(null);
    const [editValue, setEditValue] = useState('');
    // Null rather than '' because AddressSelector only ever hands back a
    // validated address or nothing — there is no partial value to hold.
    const [newAddress, setNewAddress] = useState<string | null>(null);
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
     * Load one page of tagged addresses for the current search/offset. Requests
     * one extra address so "Load more" only shows when a next page exists. A
     * fresh (non-append) load commits `nextSearch` so "Load more" paginates the
     * query that produced the visible rows rather than the live draft input,
     * preventing two unrelated result sets from being mixed. Clearing `loading`
     * in `finally` retires the first-fetch placeholder even when the request
     * fails, so a failed initial load falls through to the empty state rather
     * than spinning forever.
     *
     * @param nextSearch - Query to run; committed as the pagination anchor on a
     *                     non-append load so later pages cannot drift onto a
     *                     different, unsubmitted filter.
     * @param nextSkip - Address offset to request. Callers derive this from
     *                   `groups.length` rather than a running counter so removed
     *                   rows cannot desynchronise the next page.
     * @param append - True to extend the visible page ("Load more"), false to
     *                 replace it (initial load, search, post-mutation refresh).
     */
    const load = useCallback(async (nextSearch: string, nextSkip: number, append: boolean) => {
        try {
            const page = await searchAddresses({
                search: nextSearch || undefined,
                limit: PAGE_SIZE + 1,
                skip: nextSkip
            });
            const visible = page.slice(0, PAGE_SIZE);
            setHasMore(page.length > PAGE_SIZE);
            setGroups((current) => (append ? [...current, ...visible] : visible));
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
        const address = newAddress;
        const tags = newTags.split(',').map((tag) => tag.trim()).filter((tag) => tag.length > 0);
        if (!address || tags.length === 0) {
            notify('danger', 'Select an address and enter at least one tag');
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
            setNewAddress(null);
            setNewTags('');
            await load(committedSearch, 0, false);
        } catch (error) {
            notify('danger', 'Failed to create tags', error);
        } finally {
            setCreating(false);
        }
    }, [committedSearch, load, newAddress, newTags, notify]);

    /**
     * Commit an inline rename for the tag being edited. Refreshes from the
     * committed query for the same reason as creation: the renamed tag must
     * stay visible under the filter the admin is actually looking at.
     */
    const handleRename = useCallback(async (item: IAddressTagView) => {
        const newTag = editValue.trim();
        if (!newTag || newTag === item.tag) {
            setEditKey(null);
            return;
        }
        setBusyKey(tagKey(item));
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
     * Delete one tag after modal confirmation. The tag is spliced out of its
     * address's row locally, and the row itself drops once its last tag goes —
     * an address with no tags has nothing left for this table to show.
     */
    const handleDelete = useCallback((item: IAddressTagView) => {
        const modalId = `address-tag-delete-${tagKey(item)}`;
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
                            setGroups((current) => current
                                .map((group) => (group.address === item.address
                                    ? { ...group, tags: group.tags.filter((row) => row.tag !== item.tag) }
                                    : group))
                                .filter((group) => group.tags.length > 0));
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

    /**
     * Render one tag as a chip carrying its own rename and delete affordances,
     * swapping to an input with save/cancel while that chip is being edited.
     * Actions live on the chip rather than in a row-level column because a row
     * now holds many tags, and a single action column could not say which one
     * it acts on.
     *
     * @param item - The assignment this chip represents.
     * @returns The chip element for its address row's tag cell.
     */
    const renderTagChip = useCallback((item: IAddressTagView) => {
        const key = tagKey(item);
        const editing = editKey === key;
        const busy = busyKey === key;
        return (
            <span key={key} className="chip">
                {editing ? (
                    <>
                        <Input
                            value={editValue}
                            onChange={(event) => setEditValue(event.target.value)}
                            aria-label={`New name for tag ${item.tag}`}
                            size="sm"
                            className={styles.tag_input}
                            autoFocus
                        />
                        <Button
                            variant="primary"
                            size="xs"
                            onClick={() => void handleRename(item)}
                            disabled={busy}
                            aria-label={`Save rename of tag ${item.tag}`}
                        >
                            <Check size={14} />
                        </Button>
                        <Button
                            variant="ghost"
                            size="xs"
                            onClick={() => setEditKey(null)}
                            disabled={busy}
                            aria-label={`Cancel rename of tag ${item.tag}`}
                        >
                            <X size={14} />
                        </Button>
                    </>
                ) : (
                    <>
                        <span className={styles.tag_text}>{item.tag}</span>
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
            </span>
        );
    }, [busyKey, editKey, editValue, handleDelete, handleRename]);

    return (
        <Stack gap="lg">
            <Card>
                <div className={styles.create_form}>
                    <div className={styles.address_input}>
                        <AddressSelector
                            value={newAddress}
                            onChange={setNewAddress}
                            disabled={creating}
                            aria-label="TRON address to tag"
                        />
                    </div>
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

                    {groups.length === 0 ? (
                        <div className={styles.placeholder}>
                            {loading ? 'Loading address tags…' : 'No address tags found.'}
                        </div>
                    ) : (
                        <Table className={styles.tags_table}>
                            <Thead>
                                <Tr>
                                    <Th>Address</Th>
                                    <Th>Tags</Th>
                                    <Th>Updated</Th>
                                </Tr>
                            </Thead>
                            <Tbody>
                                {groups.map((group) => (
                                    <Tr key={group.address}>
                                        <Td data-label="Address">
                                            <TronAddress address={group.address} />
                                        </Td>
                                        <Td data-label="Tags">
                                            <div className={styles.tag_list}>
                                                {group.tags.map((item) => renderTagChip(item))}
                                            </div>
                                        </Td>
                                        <Td data-label="Updated">
                                            <ClientTime date={group.updatedAt} format="datetime" />
                                        </Td>
                                    </Tr>
                                ))}
                            </Tbody>
                        </Table>
                    )}

                    {hasMore && (
                        <Button
                            variant="secondary"
                            onClick={() => void load(committedSearch, groups.length, true)}
                        >
                            Load more
                        </Button>
                    )}
                </Stack>
            </Card>
        </Stack>
    );
}
