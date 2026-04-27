'use client';

/**
 * Form rendered inside the Create/Edit Group modal.
 *
 * Handles client-side validation of the slug shape; the server is
 * authoritative on reserved-admin enforcement and uniqueness, and any
 * server error is surfaced as a toast by the caller.
 */

import { useState } from 'react';
import { Button } from '../../../../../components/ui/Button';
import styles from './GroupsManager.module.scss';

export interface GroupFormValues {
    id: string;
    name: string;
    description: string;
}

interface GroupFormInitial {
    id: string;
    name: string;
    description: string;
}

interface Props {
    mode: 'create' | 'edit';
    initial?: GroupFormInitial;
    onCancel: () => void;
    onSubmit: (values: GroupFormValues) => void | Promise<void>;
}

/**
 * Mirrors the service's slug pattern: lowercase letters/digits/hyphens,
 * starts with a letter, doesn't end in a hyphen.
 */
function isValidSlug(id: string): boolean {
    return /^[a-z][a-z0-9-]*[a-z0-9]$|^[a-z]$/.test(id);
}

export function GroupForm({ mode, initial, onCancel, onSubmit }: Props) {
    const [id, setId] = useState(initial?.id ?? '');
    const [name, setName] = useState(initial?.name ?? '');
    const [description, setDescription] = useState(initial?.description ?? '');
    const [submitting, setSubmitting] = useState(false);

    const slugError = mode === 'create' && id && !isValidSlug(id)
        ? 'Use lowercase letters, digits, and hyphens; must start with a letter'
        : null;

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setSubmitting(true);
        try {
            await onSubmit({ id, name, description });
        } finally {
            setSubmitting(false);
        }
    };

    return (
        <form onSubmit={handleSubmit} className={styles.form}>
            <label className={styles.field}>
                <span className={styles.field_label}>ID (slug)</span>
                <input
                    type="text"
                    value={id}
                    disabled={mode === 'edit'}
                    onChange={e => setId(e.target.value.toLowerCase())}
                    placeholder="vip-traders"
                    required
                    autoFocus={mode === 'create'}
                />
                {slugError && <span className={styles.field_error}>{slugError}</span>}
                {mode === 'edit' && (
                    <span className={styles.field_hint}>
                        IDs are immutable — plugins reference groups by id.
                    </span>
                )}
            </label>

            <label className={styles.field}>
                <span className={styles.field_label}>Name</span>
                <input
                    type="text"
                    value={name}
                    onChange={e => setName(e.target.value)}
                    placeholder="VIP Traders"
                    required
                />
            </label>

            <label className={styles.field}>
                <span className={styles.field_label}>Description</span>
                <textarea
                    value={description}
                    onChange={e => setDescription(e.target.value)}
                    placeholder="Optional. Describe what this group is for."
                    rows={3}
                />
            </label>

            <div className={styles.form_actions}>
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
                    disabled={submitting || (mode === 'create' && !!slugError)}
                >
                    {submitting ? 'Saving…' : mode === 'create' ? 'Create' : 'Save'}
                </Button>
            </div>
        </form>
    );
}
