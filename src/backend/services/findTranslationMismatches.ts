/**
 * @fileoverview Compares the links, TRON addresses, and numbers in a proposed
 * translation with the English it translates.
 *
 * A curator approving a proposed translation may not read the language well
 * enough to notice a swapped wallet address or a changed affiliate link, and
 * those can be found mechanically. Language versions of a page may also
 * differ on purpose, for cultural or search reasons, so most differences are
 * listed for the curator rather than refused.
 *
 * - Refused: a TRON address or an external link the English does not
 *   contain. An external link is any target that is not a plain path on this
 *   site: it has a scheme, starts with `//` or a backslash, or contains `&`,
 *   because Markdown and HTML decode character references and could turn
 *   `/&#47;evil.example` into `//evil.example`.
 * - Listed: a dropped address or external link, a link to this site that
 *   only one side has, and a number that only one side has. A site link
 *   under the translation's own language prefix, such as `/ru/markets`,
 *   counts as the same link as `/markets`.
 * - Numbers ignore grouping and decimal separators, including a plain space
 *   before a group of exactly three digits, as Russian writes `10 000`. A
 *   one- or two-digit number only the translation has is not listed, because
 *   a translated date writes its month or day as a number.
 *
 * @module backend/services/findTranslationMismatches
 */

import type { ITranslatableField, TranslationValues } from '@/types';
import type { ITranslationAnchorReport } from './ITranslationAnchorReport.js';

/** Absolute links, stopping at whitespace, brackets, and quotes. */
const ABSOLUTE_URL_PATTERN = /https?:\/\/[^\s<>"'()[\]]+/gi;

/** Targets of Markdown links and images, which also catches relative links such as `/resource-markets`. */
const MARKDOWN_TARGET_PATTERN = /\]\(\s*<?([^)\s>]+)>?/g;

/**
 * The destination of a reference-link definition, such as `[claim]: //evil.example`.
 * The renderer resolves a reference link into a real link, and the sanitizer
 * leaves a destination with no scheme alone, so it reaches the reader as a
 * clickable link and has to be compared like an inline target. The line must
 * end after the destination and its optional title, as Markdown requires, so
 * prose beginning `[Note]: some words` is not taken for a definition.
 */
const REFERENCE_DEFINITION_PATTERN = /^[ \t]{0,3}\[[^\]\n]+\]:[ \t]*<?([^\s<>]+)>?[ \t]*(?:"[^"]*"|'[^']*'|\([^)]*\))?[ \t]*$/gm;

/**
 * The `href` or `src` of raw HTML. The renderer keeps raw HTML, the sanitizer
 * allows both attributes on `<a>` and `<img>`, and a value with no scheme
 * passes its protocol list, so raw HTML is another way a link reaches the
 * reader without Markdown link syntax.
 */
const HTML_TARGET_PATTERN = /\b(?:href|src)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+))/gi;

/**
 * A link that stays on this site: a path starting with one `/`, or a query
 * or fragment alone. A second slash or a backslash after the first would let
 * a browser read it as another host, and `&` could be a character reference
 * that decodes into one, so any of those makes the link external.
 */
const SITE_LINK_PATTERN = /^(?:\/(?![/\\])|[?#])[^\s\\&]*$/;

/** A TRON base58 address: `T` followed by 33 base58 characters. */
const TRON_ADDRESS_PATTERN = /\bT[1-9A-HJ-NP-Za-km-z]{33}\b/g;

/**
 * A number, with digits optionally grouped or split by a comma, a full stop,
 * a no-break space, or a narrow no-break space, or by a plain space before a
 * group of exactly three digits. Any other plain space ends the number, so
 * "2 3" stays two numbers.
 */
const NUMBER_PATTERN = /\d+(?:[.,  ]\d+| \d{3}(?!\d))*/g;

/** Punctuation a sentence can leave stuck to the end of a bare link. */
const TRAILING_PUNCTUATION = /[.,;:!?。，；：！？]+$/u;

/** The links, addresses, and numbers found in one version of the text. */
interface IAnchors {
    siteLinks: Set<string>;
    externalLinks: Set<string>;
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
 * Reduce a site link under the translation's own language prefix to the
 * English path, so linking the Russian version of a page is not reported as
 * a different link from the English one.
 *
 * @param link - A link already known to stay on this site.
 * @param language - The translation's language code.
 * @returns The link without its language prefix.
 */
function withoutLanguagePrefix(link: string, language: string): string {
    const prefix = `/${language}`;
    let path = link;
    if (link === prefix) {
        path = '/';
    } else if (link.startsWith(`${prefix}/`) || link.startsWith(`${prefix}?`) || link.startsWith(`${prefix}#`)) {
        const rest = link.slice(prefix.length);
        path = rest.startsWith('/') ? rest : `/${rest}`;
    }

    return path;
}

/**
 * Find the links, TRON addresses, and numbers in a piece of text.
 *
 * @param text - The combined text of every translatable field.
 * @param language - The translation's language code, whose prefix is
 *   removed from site links.
 * @returns Each kind of anchor as a set. Numbers are reduced to their digits.
 */
function findAnchors(text: string, language: string): IAnchors {
    const links: string[] = [];
    for (const match of text.matchAll(ABSOLUTE_URL_PATTERN)) {
        links.push(match[0]);
    }
    for (const match of text.matchAll(MARKDOWN_TARGET_PATTERN)) {
        links.push(match[1]);
    }
    for (const match of text.matchAll(REFERENCE_DEFINITION_PATTERN)) {
        links.push(match[1]);
    }
    for (const match of text.matchAll(HTML_TARGET_PATTERN)) {
        links.push(match[1] ?? match[2] ?? match[3] ?? '');
    }
    const siteLinks = new Set<string>();
    const externalLinks = new Set<string>();
    for (const raw of links) {
        const link = raw.replace(TRAILING_PUNCTUATION, '');
        if (link === '') {
            continue;
        }
        if (SITE_LINK_PATTERN.test(link)) {
            siteLinks.add(withoutLanguagePrefix(link, language));
        } else {
            externalLinks.add(link);
        }
    }
    // Remove the links before looking for numbers and addresses, so digits in
    // a URL are checked as part of the link rather than a second time.
    const withoutLinks = text
        .replace(ABSOLUTE_URL_PATTERN, ' ')
        .replace(MARKDOWN_TARGET_PATTERN, '] ')
        .replace(REFERENCE_DEFINITION_PATTERN, ' ')
        .replace(HTML_TARGET_PATTERN, ' ');
    const addresses = new Set<string>(withoutLinks.match(TRON_ADDRESS_PATTERN) ?? []);
    const withoutAddresses = withoutLinks.replace(TRON_ADDRESS_PATTERN, ' ');
    const numbers = new Set<string>();
    for (const match of withoutAddresses.matchAll(NUMBER_PATTERN)) {
        numbers.add(match[0].replace(/\D/g, ''));
    }

    return { siteLinks, externalLinks, addresses, numbers };
}

/**
 * List the members of one set that the other lacks, quoted for a message.
 */
function missingFrom(source: Set<string>, target: Set<string>): string[] {
    return [...source].filter((value) => !target.has(value)).map((value) => `"${value}"`);
}

/**
 * Compare a proposed translation with its English, refusing an added TRON
 * address or external link and listing every other difference.
 *
 * @param fields - The type's translatable fields; `url` fields are skipped.
 * @param english - The English values the proposal translates.
 * @param proposed - The proposed values.
 * @param language - The translation's language code, so a site link under
 *   its own prefix matches the English link.
 * @returns The refusals, written for the proposer, and the differences,
 *   written for the curator. Both are empty when the anchors match.
 */
export function findTranslationMismatches(
    fields: ReadonlyArray<ITranslatableField>,
    english: TranslationValues,
    proposed: TranslationValues,
    language: string
): ITranslationAnchorReport {
    const source = findAnchors(collectText(fields, english), language);
    const translation = findAnchors(collectText(fields, proposed), language);
    const refusals: string[] = [];
    const differences: string[] = [];

    const addedAddresses = missingFrom(translation.addresses, source.addresses);
    if (addedAddresses.length > 0) {
        refusals.push(`These TRON addresses are not in the English: ${addedAddresses.join(', ')}. A translation may not add an address; remove it, or ask an admin to add it to the English first.`);
    }
    const addedExternal = missingFrom(translation.externalLinks, source.externalLinks);
    if (addedExternal.length > 0) {
        refusals.push(`These links to other sites are not in the English: ${addedExternal.join(', ')}. A translation may not add a link to another site; remove it, or ask an admin to add it to the English first.`);
    }

    const droppedAddresses = missingFrom(source.addresses, translation.addresses);
    if (droppedAddresses.length > 0) {
        differences.push(`TRON addresses only the English has: ${droppedAddresses.join(', ')}.`);
    }
    const droppedExternal = missingFrom(source.externalLinks, translation.externalLinks);
    if (droppedExternal.length > 0) {
        differences.push(`Links to other sites only the English has: ${droppedExternal.join(', ')}.`);
    }
    const addedSite = missingFrom(translation.siteLinks, source.siteLinks);
    if (addedSite.length > 0) {
        differences.push(`Links to this site only the translation has: ${addedSite.join(', ')}.`);
    }
    const droppedSite = missingFrom(source.siteLinks, translation.siteLinks);
    if (droppedSite.length > 0) {
        differences.push(`Links to this site only the English has: ${droppedSite.join(', ')}.`);
    }
    const droppedNumbers = missingFrom(source.numbers, translation.numbers);
    if (droppedNumbers.length > 0) {
        differences.push(`Numbers only the English has: ${droppedNumbers.join(', ')}.`);
    }
    const addedNumbers = [...translation.numbers]
        .filter((value) => !source.numbers.has(value) && value.length > 2)
        .map((value) => `"${value}"`);
    if (addedNumbers.length > 0) {
        differences.push(`Numbers only the translation has: ${addedNumbers.join(', ')}.`);
    }

    return { refusals, differences };
}
