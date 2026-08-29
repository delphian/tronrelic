/**
 * @fileoverview Keeps the frontend's warning classification in step with the
 * tags this module's ingestion sources actually assert.
 *
 * The `TronAddress` chip marks a sanctioned or frozen address with a warning
 * icon. It decides which tags earn that icon from an explicit list in
 * `src/frontend/modules/address-tags/lib/tagSeverity.ts`, because frontend code
 * cannot import backend code and there is no severity field on a stored tag to
 * read instead. That leaves two copies of the same knowledge, and the dangerous
 * direction of drift is silent: a source that starts asserting a new tag, with
 * nobody adding it to the frontend list, renders a flagged address exactly like
 * a safe one. This test is what turns that into a failing build.
 *
 * When a new ingestion source is added, import its exported tag constant here
 * and add it to `SOURCE_TAGS`. The test then fails until the frontend list
 * classifies it, which is the intended prompt rather than an obstacle.
 */

import { describe, it, expect } from 'vitest';
import {
    ADDRESS_TAG_SEVERITIES,
    getAddressTagSeverity
} from '@/frontend/modules/address-tags/lib/tagSeverity';
import { OFAC_TAG } from '../sources/ofac-sdn.source.js';
import { USDT_TAG } from '../sources/usdt-blacklist.source.js';
import { CHAINALYSIS_TAG } from '../sources/chainalysis.source.js';

/**
 * Every tag a machine ingestion source can write. These are the only tags no
 * human can create — `RESERVED_TAG_PREFIXES` rejects the prefixes on every human
 * write path — so they are exactly the set the frontend has to have an opinion
 * about.
 */
const SOURCE_TAGS = [OFAC_TAG, USDT_TAG, CHAINALYSIS_TAG];

describe('address tag severity coverage', () => {
    it('classifies every tag an ingestion source asserts', () => {
        const unclassified = SOURCE_TAGS.filter((tag) => getAddressTagSeverity(tag) === undefined);

        expect(unclassified).toEqual([]);
    });

    it('classifies each source tag as a warning', () => {
        const severities = SOURCE_TAGS.map((tag) => getAddressTagSeverity(tag)?.severity);

        expect(severities).toEqual(SOURCE_TAGS.map(() => 'warning'));
    });

    it('carries no entry that no source asserts', () => {
        // A stale entry is the milder failure — it warns on a tag nothing writes
        // — but it also means the list has stopped describing reality, which is
        // how the useful direction of this test rots.
        const orphaned = ADDRESS_TAG_SEVERITIES
            .map((entry) => entry.tag)
            .filter((tag) => !SOURCE_TAGS.includes(tag));

        expect(orphaned).toEqual([]);
    });

    it('gives every entry a label that is not just the tag text', () => {
        // The label is what the chip's tooltip and its screen-reader
        // announcement say. Echoing `usdt:frozen` back at the reader would leave
        // the icon as unexplained as it was without one.
        ADDRESS_TAG_SEVERITIES.forEach((entry) => {
            expect(entry.label.trim().length).toBeGreaterThan(entry.tag.length);
            expect(entry.label).not.toBe(entry.tag);
        });
    });
});
