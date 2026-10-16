'use client';

/**
 * @fileoverview The add form shared by the localization admin tabs.
 *
 * Each tab used to put its add form in a second panel below the table, with a
 * label above every field, a hint below it, and the submit button on a line of
 * its own. That spent more height on adding one row than the table spent on
 * showing ten. This form opens from the panel's own header instead, holds its
 * fields and the submit button on a single row, and sits above the table so
 * the table can stay the last thing in the panel and run to its edges.
 *
 * @module modules/localization/components/admin/InlineAddForm
 */

import type { FormEvent, ReactNode } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '../../../../components/ui/Button';
import styles from './LocalizationAdmin.module.scss';

/** Props for {@link InlineAddForm}. */
interface IInlineAddFormProps {
    /** Element id, so the header button that opens the form can point at it with `aria-controls`. */
    id: string;
    /** Accessible name for the form, such as "Add a language", since it has no visible heading. */
    label: string;
    /** Text on the submit button; the same verb the success toast uses. */
    submitLabel: string;
    /** True while the request runs, so the button shows progress and cannot be pressed twice. */
    submitting: boolean;
    /** Handles the submission; the caller prevents the default and sends the request. */
    onSubmit: (event: FormEvent) => void;
    /** The fields, each wrapped in `Field` so it keeps a visible label. */
    children: ReactNode;
}

/**
 * Render the one-row add form with its submit button at the end of the row.
 *
 * @param props - The form id, its accessible name, the submit label and
 *        state, the submit handler, and the fields.
 * @returns The form.
 */
export function InlineAddForm({ id, label, submitLabel, submitting, onSubmit, children }: IInlineAddFormProps) {
    return (
        <form id={id} className={styles.add_form} aria-label={label} onSubmit={onSubmit}>
            {children}
            <Button
                type="submit"
                size="sm"
                variant="primary"
                loading={submitting}
                icon={<Plus size={16} />}
                className={styles.add_form_submit}
            >
                {submitLabel}
            </Button>
        </form>
    );
}
