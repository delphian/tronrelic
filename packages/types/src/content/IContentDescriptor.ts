/**
 * @file IContentDescriptor.ts
 *
 * The content-agnostic descriptor a content type produces so any core pipeline
 * can render a provider-owned effect without understanding its payload. A
 * provider flattens its own record (a drafted tweet, a generated image, a
 * pending page) into this fixed shape; the consuming pipeline — the curation
 * queue today, a notification channel tomorrow — renders from it and never
 * interprets the underlying payload. This is the seam that lets every consumer
 * stay generic while content types remain plugin-defined.
 *
 * It is deliberately the lowest common denominator across surfaces: a short
 * heading, primary body text, inline media, and supplementary facts. Surface-
 * specific concerns (a notification's severity, a curation item's decision
 * state) belong to the consuming pipeline's own envelope, never here.
 */

/**
 * A single labelled fact shown in a detail view (e.g. "Scheduled for" →
 * "2026-06-20 14:00"). Supplementary context, not the primary content.
 */
export interface IContentDescriptorField {
    /** Short label for the fact. */
    label: string;

    /** Display value, already formatted for presentation. */
    value: string;
}

/**
 * A piece of media to render inline. The provider resolves its own storage
 * reference (e.g. a `trp-files` file id) to a public URL inside `describe()`;
 * no consuming pipeline ever resolves ids itself.
 */
export interface IContentDescriptorMedia {
    /** Public URL the consumer renders inline. The provider must resolve this. */
    url: string;

    /** Rendering hint. `image` renders inline; `link` renders as an anchor. */
    kind?: 'image' | 'link';

    /** Accessible alt text / link label. */
    alt?: string;
}

/**
 * The generic, rendered view of one content instance. Every field is optional
 * so a type surfaces only what it has — a tweet sets `body` (and `media` when
 * it has an image); a future page type might set `title` and `body`. Produced
 * by {@link IContentType.describe} and consumed unchanged by whichever pipeline
 * holds the content.
 */
export interface IContentDescriptor {
    /** One-line heading for a queue row or notification title. */
    title?: string;

    /** Primary content — the text a curator reviews or a channel delivers. */
    body?: string;

    /** Media rendered inline, with provider-resolved public URLs. */
    media?: IContentDescriptorMedia[];

    /** Supplementary labelled facts shown in a detail view. */
    fields?: IContentDescriptorField[];

    /**
     * Whether the owning type offers an interactive editor for this instance.
     * A consumer shows an edit affordance only when this is true; editing always
     * writes through the provider's own routes, never through the pipeline.
     */
    editable?: boolean;
}
