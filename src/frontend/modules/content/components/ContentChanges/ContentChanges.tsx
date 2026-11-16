'use client';

/**
 * @fileoverview Shows what an edit to a managed content item changes compared
 * with the version visitors see now, field by field.
 *
 * A curator approving an edit approves every difference in it, and reading the
 * finished text alone leaves them to find the change from memory. This view
 * lists only the fields that changed: text as a line-by-line diff with the
 * changed words marked, lists as kept, added, and removed entries, and single
 * values as old and new side by side. Long unchanged stretches of text are
 * folded behind a button so the change stays in view.
 *
 * The change set arrives as plain data computed on the server, and every piece
 * of text is placed as a React text node, so content a non-curator wrote can
 * never inject markup. Changes are marked by a +/− gutter, strikethrough and
 * underline, and hidden "Added" and "Removed" labels as well as by colour, so
 * the marks survive colour blindness and screen readers.
 */

import { Fragment, useCallback, useId, useState, type ReactNode } from 'react';
import { ArrowRight } from 'lucide-react';
import type {
    ContentDiffOp,
    ContentFieldChange,
    IContentChangeSet,
    IContentDiffLine,
    IContentListChange,
    IContentTextChange,
    IContentValueChange
} from '@/types';
import { Button } from '../../../../components/ui/Button';
import styles from './ContentChanges.module.scss';

/** Unchanged lines kept visible on each side of a change, as context. */
const CONTEXT_LINES = 2;

/** Folding fewer unchanged lines than this saves no space, so they stay visible. */
const MIN_FOLDED_LINES = 3;

/** Props for {@link ContentChanges}. */
export interface IContentChangesProps {
    /** The comparison to show, as returned by the core content service. */
    changeSet: IContentChangeSet;

    /**
     * Heading for the comparison. Defaults to "Changes from the live version",
     * which suits a pending edit; a decision record names the version live at
     * decision time instead, since the live version has moved on since.
     */
    title?: string;
}

/** One visible line, or a fold of unchanged lines the reader can open. */
type DiffEntry =
    | { type: 'line'; line: IContentDiffLine; index: number }
    | { type: 'fold'; lines: IContentDiffLine[]; start: number };

/** The +/− mark drawn in a line's gutter. */
const GUTTER_MARK: Record<ContentDiffOp, string> = { equal: ' ', added: '+', removed: '−' };

/** The hidden label a screen reader announces before a changed line or entry. */
const SPOKEN_OP: Record<ContentDiffOp, string> = { equal: '', added: 'Added: ', removed: 'Removed: ' };

/**
 * Split a field's lines into visible lines and folds. Each run of unchanged
 * lines keeps `CONTEXT_LINES` next to the change before it and the change
 * after it, and the middle of the run is folded when that hides enough lines
 * to be worth a click.
 *
 * @param lines - Every line of the field's diff, in reading order.
 * @returns The entries to render, in reading order.
 */
function foldUnchangedLines(lines: IContentDiffLine[]): DiffEntry[] {
    const entries: DiffEntry[] = [];
    let index = 0;
    while (index < lines.length) {
        if (lines[index].op !== 'equal') {
            entries.push({ type: 'line', line: lines[index], index });
            index += 1;
        } else {
            let end = index;
            while (end < lines.length && lines[end].op === 'equal') {
                end += 1;
            }
            const keepBefore = index === 0 ? 0 : CONTEXT_LINES;
            const keepAfter = end === lines.length ? 0 : CONTEXT_LINES;
            const foldStart = index + keepBefore;
            const foldEnd = end - keepAfter;
            const foldable = foldEnd - foldStart >= MIN_FOLDED_LINES;
            for (let position = index; position < end; position++) {
                const folded = foldable && position >= foldStart && position < foldEnd;
                if (!folded) {
                    entries.push({ type: 'line', line: lines[position], index: position });
                } else if (position === foldStart) {
                    entries.push({ type: 'fold', lines: lines.slice(foldStart, foldEnd), start: foldStart });
                }
            }
            index = end;
        }
    }

    return entries;
}

/**
 * One line of a text diff. Words are marked only when the line mixes changed
 * and unchanged text; a line that changed as a whole is shown by its gutter
 * and background alone, because striking through every word of it would make
 * it harder to read without saying anything more.
 */
function DiffLine({ line }: { line: IContentDiffLine }) {
    const mixed = line.segments.some((segment) => segment.op !== line.op);
    const lineClass = line.op === 'added' ? styles.line_added : line.op === 'removed' ? styles.line_removed : '';
    let text: ReactNode = ' ';
    if (line.segments.length > 0) {
        text = line.segments.map((segment, index) => {
            let piece: ReactNode = segment.text;
            if (mixed && segment.op === 'added') {
                piece = <ins key={index} className={styles.word_added}>{segment.text}</ins>;
            } else if (mixed && segment.op === 'removed') {
                piece = <del key={index} className={styles.word_removed}>{segment.text}</del>;
            }
            return <Fragment key={index}>{piece}</Fragment>;
        });
    }

    return (
        <div className={`${styles.line} ${lineClass}`}>
            <span className={styles.gutter} aria-hidden="true">{GUTTER_MARK[line.op]}</span>
            <span className={styles.line_text}>
                {line.op !== 'equal' && <span className={styles.visually_hidden}>{SPOKEN_OP[line.op]}</span>}
                {text}
            </span>
        </div>
    );
}

/**
 * A text field's diff with long unchanged stretches folded. Each fold opens
 * on its own, so the reader can check the context around one change without
 * unfolding the whole body.
 */
function TextChange({ change }: { change: IContentTextChange }) {
    const [opened, setOpened] = useState<ReadonlySet<number>>(() => new Set());
    const entries = foldUnchangedLines(change.lines);

    /**
     * Open one fold, keyed by the index of its first line.
     *
     * @param start - The index of the fold's first line.
     */
    const openFold = useCallback((start: number) => {
        setOpened((previous) => new Set(previous).add(start));
    }, []);

    return (
        <>
            {change.coarse && (
                <p className={styles.note}>
                    This text was too long or too different to compare line by line, so the old text is shown
                    removed and the new text added.
                </p>
            )}
            <div className={styles.diff}>
                {entries.map((entry) => {
                    let rendered: ReactNode;
                    if (entry.type === 'line') {
                        rendered = <DiffLine key={entry.index} line={entry.line} />;
                    } else if (opened.has(entry.start)) {
                        rendered = (
                            <Fragment key={`fold-${entry.start}`}>
                                {entry.lines.map((line, offset) => <DiffLine key={entry.start + offset} line={line} />)}
                            </Fragment>
                        );
                    } else {
                        rendered = (
                            <div key={`fold-${entry.start}`} className={styles.fold}>
                                <Button variant="ghost" size="xs" onClick={() => openFold(entry.start)}>
                                    Show {entry.lines.length} unchanged lines
                                </Button>
                            </div>
                        );
                    }
                    return rendered;
                })}
            </div>
        </>
    );
}

/** A list field's entries, each shown kept, added, or removed. */
function ListChange({ change }: { change: IContentListChange }) {
    return (
        <ul className={styles.list}>
            {change.items.map((item, index) => {
                let entry: ReactNode = item.value;
                if (item.op === 'added') {
                    entry = <ins className={styles.entry_added}><span className={styles.visually_hidden}>{SPOKEN_OP.added}</span>{item.value}</ins>;
                } else if (item.op === 'removed') {
                    entry = <del className={styles.entry_removed}><span className={styles.visually_hidden}>{SPOKEN_OP.removed}</span>{item.value}</del>;
                }
                return <li key={`${item.op}-${item.value}-${index}`} className={styles.entry}>{entry}</li>;
            })}
        </ul>
    );
}

/** A single value's old and new forms, with an empty value shown as such. */
function ValueChange({ change }: { change: IContentValueChange }) {
    return (
        <p className={styles.value}>
            <del className={change.before === null ? styles.value_empty : styles.value_before}>
                <span className={styles.visually_hidden}>Was: </span>
                {change.before ?? 'empty'}
            </del>
            <ArrowRight size={14} aria-hidden="true" className={styles.value_arrow} />
            <ins className={change.after === null ? styles.value_empty : styles.value_after}>
                <span className={styles.visually_hidden}>Now: </span>
                {change.after ?? 'empty'}
            </ins>
        </p>
    );
}

/** One changed field: its label, then the layout that suits its kind. */
function FieldChange({ change }: { change: ContentFieldChange }) {
    let body: ReactNode;
    if (change.kind === 'text') {
        body = <TextChange change={change} />;
    } else if (change.kind === 'list') {
        body = <ListChange change={change} />;
    } else {
        body = <ValueChange change={change} />;
    }

    return (
        <div className={styles.field}>
            <h4 className={styles.field_label}>{change.label}</h4>
            {body}
        </div>
    );
}

/**
 * The comparison of an item's version under review with its live version.
 *
 * @param props - See {@link IContentChangesProps}.
 * @returns The changed fields, or a note when nothing is live to compare
 *   against or no compared field differs.
 */
export function ContentChanges({ changeSet, title = 'Changes from the live version' }: IContentChangesProps) {
    const headingId = useId();
    const count = changeSet.changes.length;
    let body: ReactNode;
    if (changeSet.baseline === 'none') {
        body = <p className={styles.note}>No approved version was live to compare this item with, so read the full content below.</p>;
    } else if (count === 0) {
        body = <p className={styles.note}>No reviewed field differs from the live version.</p>;
    } else {
        body = changeSet.changes.map((change) => <FieldChange key={change.field} change={change} />);
    }

    return (
        <section className={styles.changes} aria-labelledby={headingId}>
            <header className={styles.head}>
                <h3 id={headingId} className={styles.title}>
                    {changeSet.baseline === 'none' ? 'New item' : title}
                </h3>
                {count > 0 && (
                    <p className={styles.summary}>
                        {count === 1 ? '1 field changed' : `${count} fields changed`}
                        {changeSet.unchangedFields.length > 0 && ` · Unchanged: ${changeSet.unchangedFields.join(', ')}`}
                    </p>
                )}
            </header>
            {body}
        </section>
    );
}
