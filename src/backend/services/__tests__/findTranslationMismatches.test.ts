/// <reference types="vitest" />

/**
 * @fileoverview Tests for the comparison of links, TRON addresses, and numbers
 * between a proposed translation and its English. The comparison refuses the
 * differences that can hide tampering a curator cannot read, an added address
 * or external link, and lists every other difference for the curator, so each
 * kind of anchor and each allowance is pinned here.
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
    it('finds nothing in a translation that keeps every link, address, and number', () => {
        const english = { title: 'Energy', body: `Pay 1,000 TRX to ${ADDRESS}. See [markets](/resource-markets) or https://example.com/a.` };
        const proposed = { title: '能量', body: `向 ${ADDRESS} 支付 1000 TRX。请参阅 [市场](/resource-markets) 或 https://example.com/a。` };

        expect(findTranslationMismatches(fields, english, proposed, 'zh')).toEqual({ refusals: [], differences: [] });
    });

    it('refuses an added TRON address and lists the dropped one', () => {
        const report = findTranslationMismatches(fields, { title: 'A', body: `Send to ${ADDRESS}` }, { title: 'A', body: `发送到 ${OTHER_ADDRESS}` }, 'zh');

        expect(report.refusals.join(' ')).toContain(OTHER_ADDRESS);
        expect(report.differences.join(' ')).toContain(ADDRESS);
    });

    it('refuses a changed link to another site', () => {
        const report = findTranslationMismatches(
            fields,
            { title: 'A', body: '[Rent](https://partner.example/ref=1)' },
            { title: 'A', body: '[租用](https://partner.example/ref=2)' },
            'zh'
        );

        expect(report.refusals.join(' ')).toContain('https://partner.example/ref=2');
    });

    it('refuses a link added through a reference definition', () => {
        const report = findTranslationMismatches(
            fields,
            { title: 'A', body: 'Claim your reward.' },
            { title: 'A', body: '领取 [奖励][claim]。\n\n[claim]: //evil.example' },
            'zh'
        );

        expect(report.refusals.join(' ')).toContain('//evil.example');
    });

    it('refuses a link added through raw HTML', () => {
        const report = findTranslationMismatches(
            fields,
            { title: 'A', body: 'Claim your reward.' },
            { title: 'A', body: '领取 <a href="//evil.example">奖励</a>。' },
            'zh'
        );

        expect(report.refusals.join(' ')).toContain('//evil.example');
    });

    it('treats a path a browser could read as another host as an external link', () => {
        for (const target of ['/\\evil.example', '/&#47;evil.example', 'javascript:alert(1)']) {
            const report = findTranslationMismatches(fields, { title: 'A', body: 'x' }, { title: 'A', body: `[y](${target})` }, 'ru');

            expect(report.refusals.length).toBeGreaterThan(0);
        }
    });

    it('allows and lists a link to this site that only the translation has', () => {
        const report = findTranslationMismatches(
            fields,
            { title: 'A', body: 'Stake TRX.' },
            { title: 'A', body: 'Стейкинг TRX. См. [аренду энергии](/resource-markets).' },
            'ru'
        );

        expect(report.refusals).toEqual([]);
        expect(report.differences.join(' ')).toContain('/resource-markets');
    });

    it('matches a site link under the translation\'s language prefix to the English link', () => {
        const report = findTranslationMismatches(
            fields,
            { title: 'A', body: 'See [markets](/resource-markets).' },
            { title: 'A', body: 'См. [рынки](/ru/resource-markets).' },
            'ru'
        );

        expect(report).toEqual({ refusals: [], differences: [] });
    });

    it('does not read prose that looks like a label as a reference definition', () => {
        expect(findTranslationMismatches(fields, { title: 'A', body: '[Note]: some words here' }, { title: 'A', body: '[Lưu ý]: một vài từ ở đây' }, 'vi'))
            .toEqual({ refusals: [], differences: [] });
    });

    it('lists a dropped or changed figure without refusing it, and ignores separator style', () => {
        expect(findTranslationMismatches(fields, { title: 'A', body: 'Price 1.5 TRX' }, { title: 'A', body: 'Giá 1,5 TRX' }, 'vi'))
            .toEqual({ refusals: [], differences: [] });
        const changed = findTranslationMismatches(fields, { title: 'A', body: 'Price 150 TRX' }, { title: 'A', body: 'Giá 160 TRX' }, 'vi');

        expect(changed.refusals).toEqual([]);
        expect(changed.differences.join(' ')).toContain('"150"');
        expect(changed.differences.join(' ')).toContain('"160"');
    });

    it('reads a Russian group of thousands written with a plain space as one number', () => {
        expect(findTranslationMismatches(fields, { title: 'A', body: 'Stake 10,000 TRX' }, { title: 'A', body: 'Застейкайте 10 000 TRX' }, 'ru'))
            .toEqual({ refusals: [], differences: [] });
    });

    it('does not list the small numbers a translated date adds', () => {
        expect(findTranslationMismatches(fields, { title: 'A', body: 'November 22, 2026' }, { title: 'A', body: '2026年11月22日' }, 'zh'))
            .toEqual({ refusals: [], differences: [] });
    });

    it('ignores url fields, which are never proposed', () => {
        expect(findTranslationMismatches(fields, { title: 'A', body: 'x', ogImage: '/a.png' }, { title: 'A', body: 'x', ogImage: '' }, 'zh'))
            .toEqual({ refusals: [], differences: [] });
    });
});
