/**
 * @file ICurationPreview.ts
 *
 * The content-agnostic descriptor a curation type produces so core can render
 * any held item in the central queue without understanding its payload. A
 * provider flattens its own record (a drafted tweet, a generated image, a
 * pending page) into this fixed shape; core renders every type from it and
 * never interprets the underlying payload. This is the seam that lets the
 * queue stay generic while content types remain plugin-defined.
 */

/**
 * A single labelled fact shown in an item's detail view (e.g. "Scheduled for"
 * → "2026-06-20 14:00"). Supplementary context, not the primary content.
 */
export interface ICurationPreviewField {
    /** Short label for the fact. */
    label: string;

    /** Display value, already formatted for presentation. */
    value: string;
}

/**
 * A piece of media to render inline in the queue. The provider resolves its
 * own storage reference (e.g. a `trp-files` file id) to a public URL in
 * `describe()`; core never resolves ids itself.
 */
export interface ICurationPreviewMedia {
    /** Public URL the queue renders inline. The provider must resolve this. */
    url: string;

    /** Rendering hint. `image` renders inline; `link` renders as an anchor. */
    kind?: 'image' | 'link';

    /** Accessible alt text / link label. */
    alt?: string;
}

/**
 * The generic preview core caches at hold time and re-derives live while the
 * owning type is registered. Every field is optional so a type surfaces only
 * what it has — a tweet sets `body` (and `media` when it has an image); a
 * future page type might set `title` and `body`.
 */
export interface ICurationPreview {
    /** One-line heading for the queue row. */
    title?: string;

    /** Primary draft content — the text a curator reviews. */
    body?: string;

    /** Media rendered inline, with provider-resolved public URLs. */
    media?: ICurationPreviewMedia[];

    /** Supplementary labelled facts shown in the detail view. */
    fields?: ICurationPreviewField[];

    /**
     * Whether the owning type offers an interactive editor for this item. The
     * queue shows an Edit affordance only when this is true *and* the frontend
     * has a registered editor for the type; editing always writes through the
     * provider's own routes, never core.
     */
    editable?: boolean;
}
