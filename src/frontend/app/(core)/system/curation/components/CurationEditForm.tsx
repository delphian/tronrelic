'use client';

/**
 * @fileoverview The text editor opened from the review sheet's "Edit text"
 * button. It edits the generic `body` text; the owning plugin validates and
 * writes the change through its own `applyEdit`. `onSave` closes the modal on
 * success and reports failure itself, so a rejected edit (a tweet over the
 * length limit, for example) keeps the modal open for correction.
 */

import { useCallback, useState } from 'react';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Textarea } from '../../../../../components/ui/Textarea';
import styles from './CurationModals.module.scss';

/** Props for {@link CurationEditForm}. */
export interface ICurationEditFormProps {
    /** The body text to start from. */
    initialBody: string;
    /** Close without saving. */
    onCancel: () => void;
    /** Save the edited text; resolves once the save has been handled. */
    onSave: (body: string) => Promise<void>;
}

/**
 * The edit-before-deciding form.
 *
 * @param props - See {@link ICurationEditFormProps}.
 * @returns The text field and its Save and Cancel buttons.
 */
export function CurationEditForm({ initialBody, onCancel, onSave }: ICurationEditFormProps) {
    const [body, setBody] = useState(initialBody);
    const [saving, setSaving] = useState(false);

    /** Save the text, showing progress on the button until the save settles. */
    const submit = useCallback(async () => {
        setSaving(true);
        try {
            await onSave(body);
        } finally {
            setSaving(false);
        }
    }, [body, onSave]);

    return (
        <Stack gap="md">
            <Textarea
                value={body}
                onChange={event => setBody(event.target.value)}
                rows={8}
                size="sm"
                aria-label="Edit the held text"
                disabled={saving}
            />
            <div className={styles.actions}>
                <Button variant="ghost" size="xs" disabled={saving} onClick={onCancel}>Cancel</Button>
                <Button variant="primary" size="xs" loading={saving} onClick={() => { void submit(); }}>Save</Button>
            </div>
        </Stack>
    );
}
