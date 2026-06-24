/**
 * @file IContentFields.ts
 *
 * The governed typed key registry — the sanctioned escape hatch a content type
 * uses to carry machine-readable enrichment a sink reads programmatically, when
 * the four descriptor slots cannot. It exists to close the stringly-typed trap:
 * the moment one sink reads `fields['threadId']` and another reads
 * `fields['recipientGroup']`, those magic-string keys become invisible
 * point-to-point dependencies — the exact `typeId` coupling the router removes,
 * hidden behind an abstraction.
 *
 * The discipline: every legal key is declared once, here. A producer's
 * `describe()` may write only declared keys (its return type is this interface),
 * and a sink reads them only through {@link readContentField}, so a sink reading
 * a key no type declares fails the build rather than silently at runtime. When
 * two unrelated types and a sink converge on the same key, that convergence is
 * the signal to promote it to a first-class descriptor slot or a typed
 * sub-shape — adding a key here is a small, reviewed change, never an open
 * grab-bag.
 *
 * This is distinct from the descriptor's `details` array (of
 * {@link IContentDescriptorField}): `details` is a free-form, human-readable
 * label/value facts table rendered for a person; this is a governed typed map a
 * sink consumes by key. The two never substitute for each other, and only this
 * one is governed. It is surfaced on the descriptor as `fields`.
 *
 * @see ../../../../docs/system/system-content-routing.md — the `fields`
 *   governance rule and the typed-key compliance invariant (reading an unwritten
 *   key is a compile error).
 */

/**
 * The declared enrichment keys a content type may attach for sinks to read.
 * Every key is optional — a type writes only what it has, a sink reads only what
 * it needs. Seeded with the one key generic enough that any publish sink
 * benefits; new keys are added by a reviewed PR to this interface, never by a
 * sink inventing a string.
 */
export interface IContentFields {
    /**
     * The canonical public URL of the content, when it has a stable home a sink
     * can link back to (a published page, a permalink). Generic across publish
     * sinks — a tweet, a Telegram post, and a Reddit submission all benefit from
     * linking to the source — which is why it is the seed key rather than a
     * sink-specific one.
     */
    canonicalUrl?: string;
}

/**
 * Read one declared enrichment key from a descriptor's governed field map. The
 * sole sanctioned read path: the `K extends keyof IContentFields` constraint
 * makes reading an undeclared key a compile error, which is the whole point —
 * an unwritten key cannot become a silent magic-string dependency.
 *
 * @param fields - The descriptor's governed field map, or undefined when the
 *   content type wrote none.
 * @param key - A declared key from {@link IContentFields}.
 * @returns The value the content type wrote for that key, or undefined.
 */
export function readContentField<K extends keyof IContentFields>(
    fields: IContentFields | undefined,
    key: K
): IContentFields[K] | undefined {
    return fields?.[key];
}
