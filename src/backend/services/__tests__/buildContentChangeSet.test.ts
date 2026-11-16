/// <reference types="vitest" />

/**
 * @fileoverview Tests for the field-by-field comparison core builds for the
 * curation queue. Each layout (text, list, single value) is checked for what a
 * curator must be able to trust: the old side of a diff is exactly the live
 * text, the new side is exactly the edit, and an unchanged field is reported
 * as unchanged rather than shown as a diff.
 */

import { describe, it, expect } from 'vitest';
import type { IContentDiffLine, IContentTextChange } from '@/types';
import { buildContentChangeSet } from '../buildContentChangeSet.js';

/**
 * Rebuild one side of a text diff from its lines, so a test can check the diff
 * reproduces the original text exactly.
 */
function rebuild(lines: IContentDiffLine[], side: 'before' | 'after'): string {
    const skip = side === 'before' ? 'added' : 'removed';

    return lines
        .filter((line) => line.op !== skip)
        .map((line) => line.segments.filter((segment) => segment.op !== skip).map((segment) => segment.text).join(''))
        .join('\n');
}

describe('buildContentChangeSet', () => {
    it('reports only the fields that differ, in the order given', () => {
        const changeSet = buildContentChangeSet(
            [{ name: 'title', label: 'Title' }, { name: 'slug', label: 'Slug' }],
            { title: 'Old', slug: '/a' },
            { title: 'New', slug: '/a' }
        );

        expect(changeSet.baseline).toBe('approved');
        expect(changeSet.changes.map((change) => change.field)).toEqual(['title']);
        expect(changeSet.unchangedFields).toEqual(['Slug']);
    });

    it('marks the changed words inside a replaced line and keeps both sides exact', () => {
        const before = 'Energy prices fell  sharply today.';
        const after = 'Energy prices rose sharply today!';
        const [change] = buildContentChangeSet([{ name: 'body', label: 'Body' }], { body: before }, { body: after }).changes as IContentTextChange[];

        expect(change.lines.map((line) => line.op)).toEqual(['removed', 'added']);
        expect(change.lines[0].segments.some((segment) => segment.op === 'equal')).toBe(true);
        expect(change.lines[0].segments.some((segment) => segment.op === 'removed' && segment.text.includes('fell'))).toBe(true);
        expect(change.lines[1].segments.some((segment) => segment.op === 'added' && segment.text.includes('rose'))).toBe(true);
        expect(rebuild(change.lines, 'before')).toBe(before);
        expect(rebuild(change.lines, 'after')).toBe(after);
    });

    it('keeps unchanged lines of a multi-line text as equal', () => {
        const before = '# Heading\n\nFirst paragraph.\n\nSecond paragraph.';
        const after = '# Heading\n\nFirst paragraph, edited.\n\nSecond paragraph.';
        const [change] = buildContentChangeSet([{ name: 'body', label: 'Body' }], { body: before }, { body: after }).changes as IContentTextChange[];

        expect(change.lines.filter((line) => line.op === 'equal')).toHaveLength(4);
        expect(rebuild(change.lines, 'before')).toBe(before);
        expect(rebuild(change.lines, 'after')).toBe(after);
    });

    it('does not report a change for a missing final newline or Windows line endings alone', () => {
        const changeSet = buildContentChangeSet(
            [{ name: 'body', label: 'Body' }],
            { body: 'line one\r\nline two\n' },
            { body: 'line one\nline two\nline three' }
        );
        const [change] = changeSet.changes as IContentTextChange[];

        expect(change.lines.map((line) => line.op)).toEqual(['equal', 'equal', 'added']);
    });

    it('shows text set for the first time as added lines only', () => {
        const [change] = buildContentChangeSet([{ name: 'description', label: 'Description' }], { description: '' }, { description: 'Now described' }).changes as IContentTextChange[];

        expect(change.kind).toBe('text');
        expect(change.lines).toEqual([{ op: 'added', segments: [{ op: 'added', text: 'Now described' }] }]);
    });

    it('compares a list entry by entry', () => {
        const [change] = buildContentChangeSet([{ name: 'tags', label: 'Tags' }], { tags: ['tron', 'energy'] }, { tags: ['energy', 'staking'] }).changes;

        expect(change).toEqual({
            kind: 'list',
            field: 'tags',
            label: 'Tags',
            items: [
                { op: 'removed', value: 'tron' },
                { op: 'equal', value: 'energy' },
                { op: 'added', value: 'staking' }
            ]
        });
    });

    it('shows a flag as old and new words', () => {
        const [change] = buildContentChangeSet([{ name: 'published', label: 'Published' }], { published: false }, { published: true }).changes;

        expect(change).toEqual({ kind: 'value', field: 'published', label: 'Published', before: 'No', after: 'Yes' });
    });

    it('treats null, undefined, and an empty string as the same empty value', () => {
        const changeSet = buildContentChangeSet(
            [{ name: 'ogImage', label: 'Social image' }],
            { ogImage: null },
            { ogImage: '' }
        );

        expect(changeSet.changes).toEqual([]);
        expect(changeSet.unchangedFields).toEqual(['Social image']);
    });

    it('compares an object as indented JSON so one changed key shows as one changed line', () => {
        const [change] = buildContentChangeSet(
            [{ name: 'meta', label: 'Meta' }],
            { meta: { a: 1, b: 2 } },
            { meta: { a: 1, b: 3 } }
        ).changes as IContentTextChange[];

        expect(change.kind).toBe('text');
        expect(change.lines.filter((line) => line.op === 'removed')).toHaveLength(1);
        expect(change.lines.filter((line) => line.op === 'added')).toHaveLength(1);
    });
});
