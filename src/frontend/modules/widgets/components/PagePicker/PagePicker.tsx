'use client';

/**
 * @fileoverview Chooses the page the placement editor is scoped to.
 *
 * The editor answers one question at a time: "what does this page get?"
 * The picker lists the site's real pages first, then any route pattern a
 * placement already targets, then paths the operator typed this session.
 * "Every page" is the default and shows only site-wide widgets, which is
 * what most operators manage most of the time.
 *
 * @module modules/widgets/components/PagePicker
 */

import { useMemo, useState } from 'react';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Select } from '../../../../components/ui/Select';
import type { IPageOption, PageOptionSource } from '../../types/IPageOption';
import styles from './PagePicker.module.scss';

/** Headings for each option source, in display order. */
const SOURCE_GROUPS: ReadonlyArray<{ source: PageOptionSource; label: string }> = [
    { source: 'menu', label: 'Pages' },
    { source: 'pattern', label: 'Route patterns in use' },
    { source: 'custom', label: 'Typed this session' }
];

/**
 * Props for the page picker.
 */
export interface IPagePickerProps {
    /** The selected page, or null for site-wide widgets. */
    value: string | null;
    /** Every option the picker offers. */
    options: ReadonlyArray<IPageOption>;
    /** Selects a page, or null for site-wide. */
    onChange: (route: string | null) => void;
    /** Validates and adds a typed path; returns whether it was accepted. */
    onAddPath: (raw: string) => boolean;
}

/**
 * The picker: a grouped dropdown plus a field for any other path.
 *
 * @param props - See {@link IPagePickerProps}.
 * @returns The picker.
 */
export function PagePicker({ value, options, onChange, onAddPath }: IPagePickerProps) {
    const [draft, setDraft] = useState('');

    const grouped = useMemo(
        () => SOURCE_GROUPS
            .map(group => ({ ...group, options: options.filter(option => option.source === group.source) }))
            .filter(group => group.options.length > 0),
        [options]
    );

    /**
     * Submit the typed path; clear the field only when it was accepted so
     * a rejected value stays in place to be corrected.
     */
    const submitDraft = () => {
        if (onAddPath(draft)) setDraft('');
    };

    return (
        <section className={styles.picker} aria-labelledby="page-picker-heading">
            <label id="page-picker-heading" className={styles.label} htmlFor="page-picker-select">Page</label>
            <Select
                id="page-picker-select"
                size="sm"
                className={styles.select}
                value={value ?? ''}
                onChange={(e) => onChange(e.target.value === '' ? null : e.target.value)}
            >
                <option value="">Every page (site-wide widgets)</option>
                {grouped.map(group => (
                    <optgroup key={group.source} label={group.label}>
                        {group.options.map(option => (
                            <option key={option.value} value={option.value}>
                                {option.label === option.value ? option.value : `${option.label} — ${option.value}`}
                            </option>
                        ))}
                    </optgroup>
                ))}
            </Select>
            <form
                className={styles.other}
                onSubmit={(e) => { e.preventDefault(); submitDraft(); }}
            >
                <Input
                    size="sm"
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Another path, e.g. /tools/*"
                    aria-label="Another path"
                    className={styles.other_input}
                />
                <Button type="submit" variant="secondary" size="sm" disabled={draft.trim().length === 0}>
                    Go
                </Button>
            </form>
            <p className={styles.scope}>
                {value === null
                    ? 'Showing widgets that appear on every page. Widgets limited to particular pages are listed under each zone.'
                    : <>Showing what renders on <code>{value}</code>, including site-wide widgets.</>}
            </p>
        </section>
    );
}
