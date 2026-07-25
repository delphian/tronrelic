/**
 * @fileoverview Freeform tag editor for one address, rendered as a modal body.
 *
 * Tagging an address is a two-second correction an operator makes while reading
 * a table, so the editor is deliberately one text field rather than a chip
 * builder: type a comma-separated list, save, done. The field is seeded with the
 * address's current tags, and saving diffs the submitted list against them so
 * the component issues only the creates and deletes that actually changed —
 * cheaper than a delete-all/recreate, and it leaves untouched assignments' own
 * `createdAt` intact.
 *
 * Writes are admin-gated by the backend (`/api/admin/system/address-tags/*`), so
 * callers must only offer this editor to admins; a non-admin would meet a 403
 * here rather than a validation message.
 */
'use client';

import { useCallback, useMemo, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { createTags, deleteTags } from '../../api/client';
import { invalidateAddressTags } from '../../hooks/useAddressTags';
import styles from './AddressTagsEditor.module.scss';

/**
 * Props accepted by {@link AddressTagsEditor}.
 */
export interface IAddressTagsEditorProps {
    /** Address whose tags are being edited. */
    address: string;
    /** The address's current tags, used to seed the field and diff the save. */
    initialTags: string[];
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
    const [value, setValue] = useState(() => initialTags.join(', '));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Sorted copy so the diff below is order-insensitive: retyping the same tags
    // in a different order must not delete and recreate every assignment.
    const existing = useMemo(() => new Set(initialTags), [initialTags]);

    /**
     * Apply the field's contents as the address's complete tag list.
     *
     * Diffs against the seeded tags and issues at most one create batch and one
     * delete batch, then invalidates the shared read cache so every chip showing
     * this address updates without a reload.
     */
    const handleSave = useCallback(async (): Promise<void> => {
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
    }, [address, existing, onClose, value]);

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
                    disabled={saving}
                />
                <span className={styles.hint}>
                    Comma-separated. Clearing the field removes every tag from this address.
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
                    onClick={() => { void handleSave(); }}
                >
                    Save tags
                </Button>
            </div>
        </div>
    );
}
