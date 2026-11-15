'use client';

/**
 * @fileoverview The admin note editor in the user detail panel on
 * `/system/users`.
 *
 * The note is private to administrators: it is stored apart from the user's
 * own record and never reaches the account's owner. Saving an empty note
 * clears it. The editor shows who saved the note last and when, so two admins
 * working on the same account can see each other's changes.
 */

import { useCallback, useState } from 'react';
import { Save } from 'lucide-react';
import type { IAccountAdminNote } from '@/types';
import { ACCOUNT_NOTE_MAX_LENGTH } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Button } from '../../../../../components/ui/Button';
import { Field } from '../../../../../components/ui/Field';
import { Textarea } from '../../../../../components/ui/Textarea';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { saveAccountNote } from '../../../api/admin-accounts.api';
import styles from './UserDetailPanel.module.scss';

/** Props for the note editor. */
interface IAccountNoteEditorProps {
    /** The account the note is about. */
    userId: string;

    /** The stored note, or null when none has been written. */
    initialNote: IAccountAdminNote | null;

    /** Told about the note the backend saved, so the panel's copy stays current. */
    onSaved: (note: IAccountAdminNote | null) => void;
}

/**
 * Edit and save one account's admin note.
 *
 * @param props - The account, its stored note, and the save callback.
 * @returns The editor.
 */
export function AccountNoteEditor({ userId, initialNote, onSaved }: IAccountNoteEditorProps) {
    const [draft, setDraft] = useState(initialNote?.note ?? '');
    const [saved, setSaved] = useState<IAccountAdminNote | null>(initialNote);
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    const length = draft.trim().length;
    const tooLong = length > ACCOUNT_NOTE_MAX_LENGTH;
    const unchanged = draft.trim() === (saved?.note ?? '');

    /** Send the draft, then show the note as the backend stored it. */
    const handleSave = useCallback(async () => {
        setSaving(true);
        try {
            const note = await saveAccountNote(userId, draft);
            setSaved(note);
            setDraft(note?.note ?? '');
            onSaved(note);
            push({ tone: 'success', title: note ? 'Note saved' : 'Note cleared' });
        } catch (error) {
            push({ tone: 'danger', title: 'Could not save the note', description: error instanceof Error ? error.message : String(error) });
        } finally {
            setSaving(false);
        }
    }, [draft, onSaved, push, userId]);

    return (
        <Stack gap="sm">
            <Field
                label="Admin note"
                htmlFor={`account-note-${userId}`}
                hint={`Only administrators can see this. ${length.toLocaleString('en-US')} of ${ACCOUNT_NOTE_MAX_LENGTH.toLocaleString('en-US')} characters.`}
                error={tooLong ? `Keep the note to ${ACCOUNT_NOTE_MAX_LENGTH.toLocaleString('en-US')} characters.` : undefined}
            >
                <Textarea
                    id={`account-note-${userId}`}
                    size="sm"
                    rows={5}
                    className={styles.note_input}
                    value={draft}
                    invalid={tooLong}
                    placeholder="Why this account was flagged, what its owner asked for, anything the next admin should know."
                    onChange={event => setDraft(event.target.value)}
                />
            </Field>
            <div className={styles.note_footer}>
                <span className="text-muted">
                    {saved ? (
                        <>
                            Last saved <ClientTime date={saved.updatedAt} format="short" /> by{' '}
                            {saved.updatedByEmail ?? (saved.updatedBy ? 'a deleted account' : 'the admin API token')}
                        </>
                    ) : 'No note yet.'}
                </span>
                <Button
                    size="sm"
                    variant="primary"
                    loading={saving}
                    disabled={tooLong || unchanged}
                    onClick={() => void handleSave()}
                    icon={<Save size={16} aria-hidden="true" />}
                >
                    {draft.trim() === '' && saved ? 'Clear note' : 'Save note'}
                </Button>
            </div>
        </Stack>
    );
}
