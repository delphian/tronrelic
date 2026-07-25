/**
 * @fileoverview Freeform tag editor for one address, rendered as a modal body.
 *
 * Tagging an address is a two-second correction an operator makes while reading
 * a table, so the editor is deliberately one text field rather than a chip
 * builder: type a comma-separated list, save, done. Saving diffs the submitted
 * list against the address's stored tags so the component issues only the
 * creates and deletes that actually changed — cheaper than a
 * delete-all/recreate, and it leaves untouched assignments' `createdAt` intact.
 *
 * **The editor reads its own authoritative tag list on mount** and keeps the
 * field disabled until it lands. It cannot trust a caller-supplied snapshot:
 * callers get their tags from `useAddressTags`, which reports an unresolved
 * lookup and a genuinely untagged address identically (both `[]`), so a snapshot
 * taken before that lookup resolved — or after it failed — would present a
 * tagged address as empty, and the save diff would then add without removing the
 * tags the operator never saw. `initialTags` survives only as an optimistic seed
 * for the pre-load render.
 *
 * Writes are admin-gated by the backend (`/api/admin/system/address-tags/*`), so
 * callers must only offer this editor to admins; a non-admin would meet a 403
 * here rather than a validation message.
 */
'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { createTags, deleteTags, getTagsByAddresses } from '../../api/client';
import { invalidateAddressTags } from '../../hooks/useAddressTags';
import styles from './AddressTagsEditor.module.scss';

/**
 * Props accepted by {@link AddressTagsEditor}.
 */
export interface IAddressTagsEditorProps {
    /** Address whose tags are being edited. */
    address: string;
    /**
     * Optimistic seed for the field while the editor loads its own list. Purely
     * cosmetic — the save diff always uses the tags this component fetched, so a
     * stale or empty seed cannot cause a wrong write.
     */
    initialTags?: string[];
    /** Closes the hosting modal; called after a successful save and on cancel. */
    onClose: () => void;
}

/**
 * Split a submitted list into clean tag values.
 *
 * Commas are the delimiter the backend itself uses in `?tags=x,y` and are
 * rejected inside a stored tag, so they are the only separator honoured here.
 * Blank entries are dropped and duplicates collapse, which makes trailing commas
 * and double spaces harmless instead of validation errors.
 *
 * @param value - Raw field contents as typed.
 * @returns Distinct, trimmed tag values in the order entered.
 */
function parseTags(value: string): string[] {
    const seen = new Set<string>();
    value.split(',').forEach(part => {
        const tag = part.trim();
        if (tag.length > 0) {
            seen.add(tag);
        }
    });
    return [...seen];
}

/**
 * Modal body letting an admin rewrite one address's tag list.
 *
 * @param props - {@link IAddressTagsEditorProps}.
 * @returns The editor form.
 */
export function AddressTagsEditor({ address, initialTags, onClose }: IAddressTagsEditorProps) {
    const [value, setValue] = useState(() => (initialTags ?? []).join(', '));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /**
     * The address's stored tags as this editor read them, and the sole basis for
     * the save diff. `null` until the read resolves, which is what keeps the form
     * disabled — an editor that cannot state the current tags must not let an
     * operator submit a replacement for them.
     */
    const [loaded, setLoaded] = useState<string[] | null>(null);

    // Read the authoritative list on mount. A failure is surfaced and leaves the
    // form disabled rather than falling back to "no tags", because an empty list
    // is indistinguishable from a wiped one at save time.
    useEffect(() => {
        let active = true;
        getTagsByAddresses([address])
            .then(rows => {
                if (!active) return;
                const tags = rows.filter(row => row.address === address).map(row => row.tag);
                setLoaded(tags);
                setValue(tags.join(', '));
            })
            .catch(caught => {
                if (!active) return;
                setError(caught instanceof Error ? caught.message : 'Failed to load tags');
            });
        return () => { active = false; };
    }, [address]);

    /**
     * Apply the field's contents as the address's complete tag list.
     *
     * Diffs against the tags this editor loaded and issues at most one create
     * batch and one delete batch, then invalidates the shared read cache so every
     * chip showing this address updates without a reload.
     */
    const handleSave = useCallback(async (): Promise<void> => {
        if (loaded === null) {
            return;
        }
        const existing = new Set(loaded);
        const next = parseTags(value);
        const added = next.filter(tag => !existing.has(tag));
        const removed = [...existing].filter(tag => !next.includes(tag));
        setSaving(true);
        setError(null);
        try {
            if (added.length > 0) {
                await createTags(added.map(tag => ({ address, tag })));
            }
            if (removed.length > 0) {
                await deleteTags(removed.map(tag => ({ address, tag })));
            }
            invalidateAddressTags(address);
            onClose();
        } catch (caught) {
            setError(caught instanceof Error ? caught.message : 'Failed to save tags');
        } finally {
            setSaving(false);
        }
    }, [address, loaded, onClose, value]);

    return (
        <div className={styles.editor}>
            {/* The full address, untruncated: the modal covers the row it was
                opened from, and an operator about to relabel a wallet needs to
                confirm which one. Deliberately plain text rather than the
                TronAddress chip — the chip opens this editor, so consuming it
                here would make the two modules import each other. */}
            <p className={styles.address}>{address}</p>

            <label className={styles.field}>
                <span className={styles.label}>Tags</span>
                <Input
                    value={value}
                    onChange={event => setValue(event.target.value)}
                    placeholder="exchange, hot-wallet, market-payment"
                    autoFocus
                    disabled={saving || loaded === null}
                />
                <span className={styles.hint}>
                    {loaded === null && !error
                        ? 'Loading this address’s current tags…'
                        : 'Comma-separated. Clearing the field removes every tag from this address.'}
                </span>
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <div className={styles.actions}>
                <Button variant="ghost" size="sm" onClick={onClose} disabled={saving}>
                    Cancel
                </Button>
                <Button
                    variant="primary"
                    size="sm"
                    loading={saving}
                    disabled={loaded === null}
                    onClick={() => { void handleSave(); }}
                >
                    Save tags
                </Button>
            </div>
        </div>
    );
}
