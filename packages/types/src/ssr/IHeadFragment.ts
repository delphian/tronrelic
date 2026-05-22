/**
 * @fileoverview Head-fragment shape contributed via the ssr.headFragments hook.
 *
 * Models a single contribution to the rendered HTML `<head>` produced by
 * the SSR layer. The element is described declaratively — tag, attribute
 * map, and optional inner content — so contributors do not depend on the
 * concrete HTML serializer and the frontend can choose how to render or
 * de-duplicate the fragments it receives.
 *
 * Used as the threaded value of `HOOKS.ssr.headFragments`. Plugins
 * register waterfall handlers that receive the current list and return
 * the next list, conventionally by concatenation.
 *
 * @module types/ssr/IHeadFragment
 */

/**
 * Tag names supported by the head-fragment contract.
 *
 * Restricting the tag set keeps the surface auditable — the SSR
 * renderer knows exactly which element shapes it must serialize. New
 * tag kinds require a contract amendment.
 */
export type HeadFragmentTag = 'style' | 'link' | 'meta' | 'script';

/**
 * One element to render into `<head>`.
 *
 * `id` is required and must be unique across all contributions in a
 * single render — it powers React keying on the consumer side and lets
 * downstream tooling de-duplicate when multiple plugins independently
 * contribute the same logical element.
 */
export interface IHeadFragment {
    /** Stable identifier for keying and de-duplication. */
    readonly id: string;
    /** Element tag. */
    readonly tag: HeadFragmentTag;
    /** Attributes rendered as key=value pairs on the element. */
    readonly attributes?: Readonly<Record<string, string>>;
    /** Inner content for elements that have one (e.g. <style>, <script>). */
    readonly content?: string;
}
