/**
 * @fileoverview Severity classification for address-tag text.
 *
 * A stored address tag is free text — the record carries no category, severity,
 * or type field — so nothing in the data says that `usdt:frozen` is a warning
 * and `exchange` is not. Any surface wanting to mark a dangerous address has to
 * decide that for itself, and if each one decides separately they will disagree:
 * the address chip would warn on a tag the selector dropdown shows plainly.
 * This module is the one place that decision is made, so every consumer marks
 * the same tags.
 *
 * The classification is an explicit list rather than a rule over the reserved
 * `ofac:` / `usdt:` / `chainalysis:` prefixes. Those prefixes mean "written by a
 * machine ingestion source, not by a human", which only happens to coincide with
 * "dangerous" because all three sources in the deployment today are risk feeds.
 * A benign ingestion source added later would inherit a warning it never earned,
 * and the failure would be silent. Listing the tags keeps the two ideas apart.
 *
 * The cost of an explicit list is the opposite failure: a tag a source starts
 * asserting but nobody adds here renders with no warning, which looks identical
 * to a safe address. `src/backend/modules/address-tags/__tests__/tag-severity-coverage.test.ts`
 * guards against that from the backend side, where the tag constants live. It
 * imports the sources' own constants and fails when one is missing from this
 * list, and it cross-checks both against `RESERVED_TAG_PREFIXES` so that a
 * source added under a new prefix fails the build rather than shipping an
 * unmarked warning.
 *
 * This file deliberately imports nothing. It is consumed both by React
 * components and by a plain Node test, and staying dependency-free keeps both
 * cheap.
 */

/**
 * How seriously a consumer should treat a tag. Only one level exists today
 * because every classified tag is a sanctions or freeze assertion, and those all
 * warrant the same treatment. The union exists so that adding a second level —
 * an informational marker, say — does not change the type at every call site.
 */
export type AddressTagSeverity = 'warning';

/**
 * One classified tag: the exact stored text, how serious it is, and the plain
 * phrase a surface shows the user.
 */
export interface IAddressTagSeverityEntry {
    /**
     * Exact stored tag text, matched case-insensitively. These tags are written
     * only by the backend's ingestion sources, so the casing here mirrors the
     * constants those sources export.
     */
    tag: string;

    /** How seriously a consumer should treat the tag. */
    severity: AddressTagSeverity;

    /**
     * Plain phrase naming what the tag asserts and who asserted it. The tag text
     * on its own (`usdt:frozen`) reads as jargon, so this is what a surface puts
     * in a tooltip or a screen-reader label instead.
     */
    label: string;
}

/**
 * Every tag that carries a severity, in the order a surface should list them
 * when one address holds more than one. Ordered by how far the assertion
 * reaches: a sanctions listing restricts dealing with the address at all, while
 * a Tether freeze restricts one token's balance on it.
 *
 * Add an entry here whenever a backend ingestion source starts asserting a new
 * tag, or the test named in the file overview will fail.
 */
export const ADDRESS_TAG_SEVERITIES: readonly IAddressTagSeverityEntry[] = [
    {
        tag: 'ofac:sdn',
        severity: 'warning',
        label: 'Sanctioned — listed on the OFAC Specially Designated Nationals list'
    },
    {
        tag: 'chainalysis:sanctioned',
        severity: 'warning',
        label: 'Sanctioned — identified by Chainalysis screening'
    },
    {
        tag: 'usdt:frozen',
        severity: 'warning',
        label: 'Frozen — Tether has blacklisted this address for USDT'
    }
];

/**
 * Lookup index over {@link ADDRESS_TAG_SEVERITIES}, keyed by lowercased tag
 * text. Built once at module load rather than scanned per call because the
 * address chip asks this question for every tag on every address it renders, and
 * a dense table renders dozens of chips at a time.
 */
const SEVERITY_BY_TAG: ReadonlyMap<string, IAddressTagSeverityEntry> = new Map(
    ADDRESS_TAG_SEVERITIES.map((entry) => [entry.tag.toLowerCase(), entry])
);

/**
 * Classify one tag.
 *
 * Matching ignores case and surrounding whitespace so that a tag which reached
 * storage before the current validation, or through a direct edit in the
 * `/system/database` collection browser, still classifies. A tag stored as
 * `USDT:Frozen` reads identically to the real thing to a person, and silently
 * failing to warn on it is the worst outcome available here.
 *
 * @param tag - Tag text as stored on the assignment, passed straight through
 *        from the read cache so the caller does not have to normalize it first.
 * @returns The matching entry, or `undefined` when the tag carries no severity.
 *          That is the common case, since most tags are human labels.
 */
export function getAddressTagSeverity(tag: string): IAddressTagSeverityEntry | undefined {
    const result = SEVERITY_BY_TAG.get(tag.trim().toLowerCase());

    return result;
}

/**
 * Reduce an address's full tag list to just the warnings on it.
 *
 * Results come back in the order {@link ADDRESS_TAG_SEVERITIES} declares rather
 * than the order the tags arrived in, so an address carrying both a sanctions
 * listing and a freeze always describes them the same way. Storage returns tags
 * ordered by text, which would otherwise put the freeze first purely because
 * `u` sorts after `o`.
 *
 * @param tags - Every tag on one address, as `useAddressTags` resolves it.
 * @returns The classified subset, empty for the great majority of addresses.
 *          A caller treats a non-empty result as "show the warning affordance".
 */
export function getAddressTagWarnings(tags: string[]): IAddressTagSeverityEntry[] {
    const matched = new Set<IAddressTagSeverityEntry>();
    tags.forEach((tag) => {
        const entry = getAddressTagSeverity(tag);
        if (entry) {
            matched.add(entry);
        }
    });
    const result = ADDRESS_TAG_SEVERITIES.filter((entry) => matched.has(entry));

    return result;
}
