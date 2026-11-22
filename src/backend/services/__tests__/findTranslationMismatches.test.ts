/// <reference types="vitest" />

/**
 * @fileoverview Tests for the comparison of links, TRON addresses, and numbers
 * between a proposed translation and its English. The comparison is what stops
 * a swapped address or link from passing review by a curator who cannot read
 * the language, so each kind of anchor and each allowance is pinned here.
 */

import { describe, it, expect } from 'vitest';
import type { ITranslatableField } from '@/types';
import { findTranslationMismatches } from '../findTranslationMismatches.js';

const fields: ITranslatableField[] = [
    { name: 'title', label: 'Title', kind: 'text', required: true },
    { name: 'body', label: 'Body', kind: 'markdown', required: true },
    { name: 'ogImage', label: 'Social image', kind: 'url', required: false }
];

const ADDRESS = 'TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7';
const OTHER_ADDRESS = 'TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf';

describe('findTranslationMismatches', () => {
    it('accepts a translation that keeps every link, address, and number', () => {
        const english = { title: 'Energy', body: `Pay 1,000 TRX to ${ADDRESS}. See [markets](/resource-markets) or https://example.com/a.` };
        const proposed = { title: '能量', body: `向 ${ADDRESS} 支付 1000 TRX。请参阅 [市场](/resource-markets) 或 https://example.com/a。` };

        expect(findTranslationMismatches(fields, english, proposed)).toEqual([]);
    });

    it('reports a swapped TRON address in both directions', () => {
        const problems = findTranslationMismatches(fields, { title: 'A', body: `Send to ${ADDRESS}` }, { title: 'A', body: `发送到 ${OTHER_ADDRESS}` });

        expect(problems.join(' ')).toContain(ADDRESS);
        expect(problems.join(' ')).toContain(OTHER_ADDRESS);
    });

    it('reports a changed link target', () => {
        const problems = findTranslationMismatches(
            fields,
            { title: 'A', body: '[Rent](https://partner.example/ref=1)' },
            { title: 'A', body: '[租用](https://partner.example/ref=2)' }
        );

        expect(problems.some((problem) => problem.includes('links'))).toBe(true);
    });

    it('reports a link added through a reference definition', () => {
        const problems = findTranslationMismatches(
            fields,
            { title: 'A', body: 'Claim your reward.' },
            { title: 'A', body: '领取 [奖励][claim]。\n\n[claim]: //evil.example' }
        );

        expect(problems.join(' ')).toContain('//evil.example');
    });

    it('reports a link added through raw HTML', () => {
        const problems = findTranslationMismatches(
            fields,
            { title: 'A', body: 'Claim your reward.' },
            { title: 'A', body: '领取 <a href="//evil.example">奖励</a>。' }
        );

        expect(problems.join(' ')).toContain('//evil.example');
    });

    it('does not read prose that looks like a label as a reference definition', () => {
        expect(findTranslationMismatches(fields, { title: 'A', body: '[Note]: some words here' }, { title: 'A', body: '[Lưu ý]: một vài từ ở đây' })).toEqual([]);
    });

    it('reports a dropped or changed figure but ignores separator style', () => {
        expect(findTranslationMismatches(fields, { title: 'A', body: 'Price 1.5 TRX' }, { title: 'A', body: 'Giá 1,5 TRX' })).toEqual([]);
        expect(findTranslationMismatches(fields, { title: 'A', body: 'Price 15 TRX' }, { title: 'A', body: 'Giá 16 TRX' }).length).toBeGreaterThan(0);
    });

    it('allows the small numbers a translated date adds', () => {
        expect(findTranslationMismatches(fields, { title: 'A', body: 'November 22, 2026' }, { title: 'A', body: '2026年11月22日' })).toEqual([]);
    });

    it('ignores url fields, which are never proposed', () => {
        expect(findTranslationMismatches(fields, { title: 'A', body: 'x', ogImage: '/a.png' }, { title: 'A', body: 'x', ogImage: '' })).toEqual([]);
    });
});
