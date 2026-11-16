/**
 * @fileoverview Compares two versions of a content item, field by field, and
 * returns the plain-data change set a curator reviews before approving.
 *
 * Core builds this once for every managed content type, so no type writes its
 * own comparison. It works on the raw field values the type already stores and
 * picks a layout from each value's shape: line-and-word diffs for text, kept,
 * added, and removed entries for lists of short values, and old-and-new values
 * for everything else.
 *
 * jsdiff facts this file relies on:
 * - `diffLines` treats a final line with no trailing newline as different from
 *   the same line with one, so both texts are normalized to end in a newline.
 * - `diffWords` moves whitespace between the old and new sides, so its "old"
 *   output is not exactly the old text. `diffWordsWithSpace` rebuilds both
 *   sides exactly, which a review tool needs.
 * - The `timeout` option returns `undefined` instead of a result when the
 *   comparison takes longer than allowed.
 *
 * @module backend/services/buildContentChangeSet
 */

import { diffArrays, diffLines, diffWordsWithSpace } from 'diff';
import type {
    ContentDiffOp,
    ContentFieldChange,
    IContentChangeSet,
    IContentDiffLine,
    IContentDiffSegment,
    IContentListChangeItem
} from '@/types';

/** One field to compare: its name on the record and the label a reviewer reads. */
export interface IChangeSetField {
    name: string;
    label: string;
}

/**
 * How long a single line or word comparison may run before the field falls
 * back to showing the whole old and new text. Bounds the cost of a request on
 * a very long or completely rewritten body.
 */
const DIFF_TIMEOUT_MS = 250;

/**
 * Lines longer than this are not split into words. A single enormous line,
 * such as minified data pasted into a body, gains nothing from word marks and
 * would spend the whole time budget.
 */
const WORD_DIFF_MAX_LINE_LENGTH = 5000;

/** The shape a value is compared as. `empty` matches whatever the other side is. */
type ValueShape = 'empty' | 'text' | 'list' | 'value' | 'structured';

/** A change object as jsdiff returns it, reduced to the fields used here. */
interface IDiffPart<T> {
    value: T;
    added: boolean;
    removed: boolean;
}

/**
 * Compare two versions of an item over the given fields.
 *
 * @param fields - The fields to compare, in the order the reviewer should read
 *   them; normally the type's reviewed fields with their labels.
 * @param before - The live (approved) version's field values.
 * @param after - The version under review.
 * @returns The change set with `baseline: 'approved'`. A caller with nothing
 *   live to compare against builds the `none` baseline itself.
 */
export function buildContentChangeSet(
    fields: ReadonlyArray<IChangeSetField>,
    before: Record<string, unknown>,
    after: Record<string, unknown>
): IContentChangeSet {
    const changes: ContentFieldChange[] = [];
    const unchangedFields: string[] = [];
    for (const field of fields) {
        const change = compareField(field, before[field.name], after[field.name]);
        if (change) {
            changes.push(change);
        } else {
            unchangedFields.push(field.label);
        }
    }

    return { baseline: 'approved', changes, unchangedFields };
}

/**
 * Compare one field and build its change, choosing the layout from the shape
 * of the two values.
 *
 * @param field - The field's name and label.
 * @param before - The live value.
 * @param after - The value under review.
 * @returns The change, or null when the two values show the same thing.
 */
function compareField(field: IChangeSetField, before: unknown, after: unknown): ContentFieldChange | null {
    const shape = combineShapes(shapeOf(before), shapeOf(after));
    let change: ContentFieldChange | null = null;
    if (shape === 'text' || shape === 'structured') {
        const beforeText = shape === 'text' ? toText(before) : toStructuredText(before);
        const afterText = shape === 'text' ? toText(after) : toStructuredText(after);
        if (beforeText !== afterText) {
            const { lines, coarse } = diffText(beforeText, afterText);
            change = { kind: 'text', field: field.name, label: field.label, lines, ...(coarse ? { coarse } : {}) };
        }
    } else if (shape === 'list') {
        const items = diffList(toList(before), toList(after));
        if (items.some((item) => item.op !== 'equal')) {
            change = { kind: 'list', field: field.name, label: field.label, items };
        }
    } else {
        const beforeValue = formatValue(before);
        const afterValue = formatValue(after);
        if (beforeValue !== afterValue) {
            change = { kind: 'value', field: field.name, label: field.label, before: beforeValue, after: afterValue };
        }
    }

    return change;
}

/** Classify a raw field value by the layout that shows its changes best. */
function shapeOf(value: unknown): ValueShape {
    let shape: ValueShape = 'structured';
    if (value === null || value === undefined || value === '') {
        shape = 'empty';
    } else if (typeof value === 'string') {
        shape = 'text';
    } else if (typeof value === 'boolean' || typeof value === 'number' || value instanceof Date) {
        shape = 'value';
    } else if (Array.isArray(value) && value.every((entry) => typeof entry === 'string' || typeof entry === 'number')) {
        shape = 'list';
    }

    return shape;
}

/**
 * Pick one layout for a pair of values. An empty side takes the other side's
 * shape, so a description going from nothing to a sentence is still a text
 * change. Two different non-empty shapes, such as a number replaced by a word,
 * are shown as old and new values.
 */
function combineShapes(before: ValueShape, after: ValueShape): ValueShape {
    let shape: ValueShape = 'value';
    if (before === after) {
        shape = before === 'empty' ? 'value' : before;
    } else if (before === 'empty') {
        shape = after;
    } else if (after === 'empty') {
        shape = before;
    }

    return shape;
}

/** A text value, or the empty string for a missing one. */
function toText(value: unknown): string {
    return typeof value === 'string' ? value : '';
}

/**
 * An object or mixed list as indented JSON, so a change to one key shows as a
 * changed line rather than as the whole value replaced.
 */
function toStructuredText(value: unknown): string {
    return value === null || value === undefined ? '' : JSON.stringify(value, null, 2);
}

/** A list value as strings, or an empty list for a missing one. */
function toList(value: unknown): string[] {
    return Array.isArray(value) ? value.map((entry) => String(entry)) : [];
}

/**
 * A scalar formatted for display. Yes-or-no flags read as words, and every
 * kind of nothing reads as null so the renderer can show one "empty" marker.
 */
function formatValue(value: unknown): string | null {
    let text: string | null;
    if (value === null || value === undefined || value === '') {
        text = null;
    } else if (typeof value === 'boolean') {
        text = value ? 'Yes' : 'No';
    } else if (value instanceof Date) {
        text = value.toISOString();
    } else if (typeof value === 'object') {
        text = JSON.stringify(value);
    } else {
        text = String(value);
    }

    return text;
}

/**
 * Compare two lists entry by entry, keeping the order of both.
 *
 * @param before - The live entries.
 * @param after - The entries under review.
 * @returns Every entry of both lists, each marked kept, added, or removed.
 */
function diffList(before: string[], after: string[]): IContentListChangeItem[] {
    const parts = diffArrays(before, after) as IDiffPart<string[]>[];
    const items: IContentListChangeItem[] = [];
    for (const part of parts) {
        const op = opOf(part);
        for (const value of part.value) {
            items.push({ op, value });
        }
    }

    return items;
}

/**
 * Compare two texts line by line, then mark the changed words inside each
 * pair of lines where one replaced the other.
 *
 * @param before - The live text.
 * @param after - The text under review.
 * @returns The lines in reading order, and whether the comparison timed out
 *   and fell back to the whole old text removed and the whole new text added.
 */
function diffText(before: string, after: string): { lines: IContentDiffLine[]; coarse: boolean } {
    const parts = diffLines(withFinalNewline(before), withFinalNewline(after), { timeout: DIFF_TIMEOUT_MS }) as
        IDiffPart<string>[] | undefined;
    let lines: IContentDiffLine[];
    let coarse = false;
    if (!parts) {
        coarse = true;
        lines = [...wholeLines(splitLines(before), 'removed'), ...wholeLines(splitLines(after), 'added')];
    } else {
        lines = [];
        let index = 0;
        while (index < parts.length) {
            const part = parts[index];
            const next = parts[index + 1];
            if (next && part.removed && next.added) {
                lines.push(...pairLines(splitLines(part.value), splitLines(next.value)));
                index += 2;
            } else if (next && part.added && next.removed) {
                lines.push(...pairLines(splitLines(next.value), splitLines(part.value)));
                index += 2;
            } else {
                lines.push(...wholeLines(splitLines(part.value), opOf(part)));
                index += 1;
            }
        }
    }

    return { lines, coarse };
}

/**
 * Lay out a block of removed lines and the block that replaced it: every
 * removed line, then every added line, as a code review shows them. The two
 * blocks are matched line by line in order, and each matched pair is split by
 * word so the reviewer sees which words changed. Lines past the shorter block
 * have no partner and are shown whole.
 */
function pairLines(removed: string[], added: string[]): IContentDiffLine[] {
    const removedLines: IContentDiffLine[] = [];
    const addedLines: IContentDiffLine[] = [];
    for (let index = 0; index < Math.max(removed.length, added.length); index++) {
        const oldLine = removed[index];
        const newLine = added[index];
        if (oldLine !== undefined && newLine !== undefined) {
            const [oldSegments, newSegments] = diffWordsInLine(oldLine, newLine);
            removedLines.push({ op: 'removed', segments: oldSegments });
            addedLines.push({ op: 'added', segments: newSegments });
        } else if (oldLine !== undefined) {
            removedLines.push(wholeLine(oldLine, 'removed'));
        } else if (newLine !== undefined) {
            addedLines.push(wholeLine(newLine, 'added'));
        }
    }

    return [...removedLines, ...addedLines];
}

/**
 * Split a replaced line and its replacement into segments marking the words
 * that changed. Falls back to whole-line segments for a line too long to
 * compare by word, or when the comparison times out.
 *
 * @returns The old line's segments (`equal` and `removed`) and the new line's
 *   segments (`equal` and `added`).
 */
function diffWordsInLine(oldLine: string, newLine: string): [IContentDiffSegment[], IContentDiffSegment[]] {
    const tooLong = oldLine.length > WORD_DIFF_MAX_LINE_LENGTH || newLine.length > WORD_DIFF_MAX_LINE_LENGTH;
    const parts = tooLong
        ? undefined
        : diffWordsWithSpace(oldLine, newLine, { timeout: DIFF_TIMEOUT_MS }) as IDiffPart<string>[] | undefined;
    let result: [IContentDiffSegment[], IContentDiffSegment[]];
    if (!parts) {
        result = [wholeLine(oldLine, 'removed').segments, wholeLine(newLine, 'added').segments];
    } else {
        const oldSegments: IContentDiffSegment[] = [];
        const newSegments: IContentDiffSegment[] = [];
        for (const part of parts) {
            const op = opOf(part);
            if (op !== 'added') {
                appendSegment(oldSegments, op, part.value);
            }
            if (op !== 'removed') {
                appendSegment(newSegments, op, part.value);
            }
        }
        result = [oldSegments, newSegments];
    }

    return result;
}

/** Add text to a segment list, merging it into the last segment when the outcome matches. */
function appendSegment(segments: IContentDiffSegment[], op: ContentDiffOp, text: string): void {
    const last = segments[segments.length - 1];
    if (text !== '' && last && last.op === op) {
        last.text += text;
    } else if (text !== '') {
        segments.push({ op, text });
    }

    return;
}

/** Lines that each carry one outcome, shown whole. */
function wholeLines(lines: string[], op: ContentDiffOp): IContentDiffLine[] {
    return lines.map((line) => wholeLine(line, op));
}

/** One line shown whole, as a single segment with the line's own outcome. */
function wholeLine(line: string, op: ContentDiffOp): IContentDiffLine {
    return { op, segments: line === '' ? [] : [{ op, text: line }] };
}

/** Map a jsdiff change object to the shared diff vocabulary. */
function opOf(part: IDiffPart<unknown>): ContentDiffOp {
    let op: ContentDiffOp = 'equal';
    if (part.added) {
        op = 'added';
    } else if (part.removed) {
        op = 'removed';
    }

    return op;
}

/**
 * Normalize a text so its last line ends in a newline, and Windows line
 * endings become plain newlines. An empty text stays empty, so a field going
 * from nothing to text shows only added lines.
 */
function withFinalNewline(text: string): string {
    const normalized = text.replace(/\r\n?/g, '\n');

    return normalized === '' || normalized.endsWith('\n') ? normalized : `${normalized}\n`;
}

/**
 * Split a block of text into lines without their line breaks. The trailing
 * newline that `withFinalNewline` added does not produce an extra empty line.
 */
function splitLines(text: string): string[] {
    const normalized = text.replace(/\r\n?/g, '\n');
    const trimmed = normalized.endsWith('\n') ? normalized.slice(0, -1) : normalized;

    return normalized === '' ? [] : trimmed.split('\n');
}
