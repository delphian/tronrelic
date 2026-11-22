/**
 * @fileoverview Compares the links, TRON addresses, and numbers in a proposed
 * translation with the English it translates.
 *
 * A curator approving a proposed translation may not read the language well
 * enough to notice a swapped wallet address, a changed affiliate link, or an
 * altered price. Those are the parts of a text a translation must never
 * change, and they can be found mechanically, so a proposal whose links,
 * addresses, or numbers differ from the English is refused before it reaches
 * the curation queue.
 *
 * - Links and TRON addresses must match exactly, in both directions.
 * - Every number in the English must appear in the translation. Grouping and
 *   decimal separators are ignored, because languages write them differently.
 * - A number in the translation that is not in the English is allowed only
 *   when it is a one- or two-digit integer, because a translated date writes
 *   its month or day as a number where English uses a word.
 *
 * @module backend/services/findTranslationMismatches
 */

import type { ITranslatableField, TranslationValues } from '@/types';

/** Absolute links, stopping at whitespace, brackets, and quotes. */
const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/gi;

/** Targets of Markdown links and images, which also catches relative links such as `/resource-markets`. */
const MARKDOWN_TARGET_PATTERN = /\]\(\s*<?([^)\s>]+)>?/g;

/** A TRON base58 address: `T` followed by 33 base58 characters. */
const TRON_ADDRESS_PATTERN = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g;

/**
 * A number, with digits optionally grouped or split by a comma, a full stop,
 * a no-break space, or a narrow no-break space. A plain space is not a
 * separator, so two numbers in a row stay two numbers.
 */
const NUMBER_PATTERN = /\d+(?:[.,  ]\d+)*/g;

/** Punctuation a sentence can leave stuck to the end of a bare link. */
const TRAILING_PUNCTUATION = /[.,;:!?。，；：！？]+$/u;

/** The text, links, addresses, and numbers found in one version of the text. */
interface IAnchors {
    links: Set<string>;
    addresses: Set<string>;
    numbers: Set<string>;
}

/**
 * Collect the text of every field a translator writes, leaving out `url`
 * fields, which carry over unchanged and are never proposed.
 */
function collectText(fields: ReadonlyArray<ITranslatableField>, values: TranslationValues): string {
    const parts: string[] = [];
    for (const field of fields) {
        const value = values[field.name];
        if (field.kind === 'url' || value === undefined) {
            continue;
        }
        parts.push(Array.isArray(value) ? value.join('\n') : value);
    }

    return parts.join('\n');
}

/**
 * Find the links, TRON addresses, and numbers in a piece of text.
 *
 * @param text - The combined text of every translatable field.
 * @returns Each kind of anchor as a set. Numbers are reduced to their digits.
 */
function findAnchors(text: string): IAnchors {
    const links = new Set<string>();
    for (const match of text.matchAll(ABSOLUTE_URL_PATTERN)) {
        links.add(match[0].replace(TRAILING_PUNCTUATION, ''));
    }
    for (const match of text.matchAll(MARKDOWN_TARGET_PATTERN)) {
        links.add(match[1].replace(TRAILING_PUNCTUATION, ''));
    }
    // Remove the links before looking for numbers and addresses, so digits in
    // a URL are checked as part of the link rather than a second time.
    const withoutLinks = text.replace(ABSOLUTE_URL_PATTERN, ' ').replace(MARKDOWN_TARGET_PATTERN, '] ');
    const addresses = new Set<string>(withoutLinks.match(TRON_ADDRESS_PATTERN) ?? []);
    const withoutAddresses = withoutLinks.replace(TRON_ADDRESS_PATTERN, ' ');
    const numbers = new Set<string>();
    for (const match of withoutAddresses.matchAll(NUMBER_PATTERN)) {
        numbers.add(match[0].replace(/\D/g, ''));
    }

    return { links, addresses, numbers };
}

/**
 * List the members of one set that the other lacks, quoted for a message.
 */
function missingFrom(source: Set<string>, target: Set<string>): string[] {
    return [...source].filter((value) => !target.has(value)).map((value) => `"${value}"`);
}

/**
 * Compare a proposed translation with its English and describe every
 * difference in a link, TRON address, or number.
 *
 * @param fields - The type's translatable fields; `url` fields are skipped.
 * @param english - The English values the proposal translates.
 * @param proposed - The proposed values.
 * @returns One sentence per kind of difference, written for the proposer to
 *   correct from; empty when the anchors match.
 */
export function findTranslationMismatches(
    fields: ReadonlyArray<ITranslatableField>,
    english: TranslationValues,
    proposed: TranslationValues
): string[] {
    const source = findAnchors(collectText(fields, english));
    const translation = findAnchors(collectText(fields, proposed));
    const problems: string[] = [];

    const droppedLinks = missingFrom(source.links, translation.links);
    const addedLinks = missingFrom(translation.links, source.links);
    if (droppedLinks.length > 0) {
        problems.push(`These links in the English are missing from the translation: ${droppedLinks.join(', ')}.`);
    }
    if (addedLinks.length > 0) {
        problems.push(`These links in the translation are not in the English: ${addedLinks.join(', ')}.`);
    }

    const droppedAddresses = missingFrom(source.addresses, translation.addresses);
    const addedAddresses = missingFrom(translation.addresses, source.addresses);
    if (droppedAddresses.length > 0) {
        problems.push(`These TRON addresses in the English are missing from the translation: ${droppedAddresses.join(', ')}.`);
    }
    if (addedAddresses.length > 0) {
        problems.push(`These TRON addresses in the translation are not in the English: ${addedAddresses.join(', ')}.`);
    }

    const droppedNumbers = missingFrom(source.numbers, translation.numbers);
    const addedNumbers = [...translation.numbers]
        .filter((value) => !source.numbers.has(value) && value.length > 2)
        .map((value) => `"${value}"`);
    if (droppedNumbers.length > 0) {
        problems.push(`These numbers in the English are missing from the translation; write each in digits: ${droppedNumbers.join(', ')}.`);
    }
    if (addedNumbers.length > 0) {
        problems.push(`These numbers in the translation are not in the English: ${addedNumbers.join(', ')}.`);
    }

    return problems;
}
