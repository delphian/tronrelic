/**
 * @file IPageTranslationSource.ts
 *
 * The English text a page's translations are written against. The backend
 * picks this version once, and the translation editor, the Suggest button,
 * and the stale flag all use it, so a translator never works from different
 * text than the stale check compares with.
 *
 * It is the version visitors are served, or the latest edit when no version is
 * served yet. An English edit waiting for review is not used, because a
 * curator may reject it, and a translation of it would then put text live in
 * another language that never went live in English.
 */

/**
 * The English page as translators see it in the editor.
 */
export interface IPageTranslationSource {
    /** English title, from the frontmatter. */
    title: string;

    /** English SEO description, from the frontmatter. */
    description: string;

    /** English SEO keywords, from the frontmatter. */
    keywords: string[];

    /** English Open Graph image URL, or null when the page has none. */
    ogImage: string | null;

    /** Full English markdown including the frontmatter block. */
    content: string;

    /**
     * True when a newer English edit that changes the translatable text is
     * waiting for review. Once a curator approves it, every translation
     * written against this source is flagged stale, so the editor warns the
     * translator that a second pass is coming.
     */
    pendingEdit: boolean;
}
