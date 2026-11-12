'use client';

/**
 * Modal body that asks an admin to confirm deleting a user account.
 *
 * Deleting an account signs the user out everywhere and stops them signing in
 * again, so a single click must not be enough. The admin types the account's
 * email address, and the Delete button stays disabled until it matches. The
 * typed address is sent with the request, and the server compares it again, so
 * this form is a guard against a wrong-row click and not the only check.
 *
 * Pattern: client-only admin tool, like `UserGroupsForm`. The page is
 * admin-gated, so SSR + Live Updates does not apply.
 */

import { useId, useState } from 'react';
import { Button } from '../../../../../components/ui/Button';
import { Field } from '../../../../../components/ui/Field';
import { Input } from '../../../../../components/ui/Input';
import styles from './DeleteUserForm.module.scss';

/**
 * Props for {@link DeleteUserForm}.
 */
interface IDeleteUserFormProps {
    /** Email address of the account being deleted; the admin must type it to confirm. */
    email: string;

    /** Closes the modal without deleting anything. */
    onCancel: () => void;

    /**
     * Sends the deletion. Receives the address the admin typed, which the
     * server checks against the account.
     */
    onSubmit: (confirmEmail: string) => void | Promise<void>;
}

/**
 * Confirmation form for deleting one user account.
 *
 * @param props - The account's email and the cancel and submit handlers.
 * @returns The form rendered inside the confirmation modal.
 */
export function DeleteUserForm({ email, onCancel, onSubmit }: IDeleteUserFormProps) {
    const [typed, setTyped] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const inputId = useId();

    const matches = typed.trim().toLowerCase() === email.toLowerCase();

    /**
     * Submit the deletion once the typed address matches. The button is
     * disabled while the request runs so a double click sends one request.
     *
     * @param event - The form's submit event, cancelled so the page does not reload.
     */
    const handleSubmit = async (event: React.FormEvent) => {
        event.preventDefault();
        if (matches) {
            setSubmitting(true);
            try {
                await onSubmit(typed.trim());
            } finally {
                setSubmitting(false);
            }
        }
    };

    return (
        <form onSubmit={handleSubmit} className={styles.form}>
            <p className={styles.summary}>
                Deleting <strong>{email}</strong> signs the user out on every device, disconnects their
                connected apps, removes them from every group, and stops them signing in again.
            </p>
            <p className={styles.note}>
                The account record and its history are kept, so audit logs and sign-in events still
                show who this was.
            </p>

            <Field
                label="Type the account's email address to confirm"
                htmlFor={inputId}
            >
                <Input
                    id={inputId}
                    type="email"
                    value={typed}
                    onChange={(event) => setTyped(event.target.value)}
                    autoComplete="off"
                    disabled={submitting}
                />
            </Field>

            <div className={styles.actions}>
                <Button type="button" variant="ghost" onClick={onCancel} disabled={submitting}>
                    Cancel
                </Button>
                <Button type="submit" variant="danger" disabled={!matches || submitting}>
                    {submitting ? 'Deleting…' : 'Delete user'}
                </Button>
            </div>
        </form>
    );
}
