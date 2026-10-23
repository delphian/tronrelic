/**
 * @file IContentTranslationsProps.ts
 *
 * Props of the core translation editor, `ContentTranslations`. Declared here
 * so the component and the plugin-facing `context.system.ContentTranslations`
 * share one shape: a content type's admin page, whether core's or a plugin's,
 * mounts the same editor for one of its items.
 */

/**
 * What the translation editor needs to know about the item it edits.
 */
export interface IContentTranslationsProps {
    /** The managed content type, such as `core:page`. */
    typeId: string;

    /** Core content id of the item being translated. */
    contentId: string;

    /** The item's English title, shown in the headings. */
    title: string;

    /**
     * The English address the item is served at, so the editor can name the
     * translated address. Null when the item has no public address.
     */
    publicPath: string | null;

    /**
     * Renders a Markdown field's draft to HTML for the preview pane. Supplied
     * by a type whose Markdown is rendered in a way only it knows; leave it out
     * and the editor offers no preview.
     */
    renderPreview?: (markdown: string) => Promise<string>;

    /** Returns to the content type's own list. */
    onClose: () => void;
}
