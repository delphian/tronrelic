/**
 * @fileoverview Rehype plugin that turns ` ```widget ` code blocks into
 * embedded-widget placeholders.
 *
 * Authors embed a widget in a page or post by writing a fenced code block
 * whose language is `widget` and whose body is JSON naming the widget type
 * and its settings. Markdown renders that as an ordinary code block. This
 * plugin runs after sanitizing and replaces each such block with an empty
 * `<tr-widget>` placeholder carrying the checked embed, which the content
 * endpoints resolve into widget data and the frontend renders as the widget.
 *
 * - Only blocks that are direct children of the body are converted. A
 *   placeholder nested in a list or quote would split that element in two
 *   when the frontend cuts the HTML at the placeholder, so nested blocks stay
 *   code blocks.
 * - A block whose body is not a valid embed also stays a code block, so the
 *   author sees the mistake in the editor preview instead of losing the text.
 * - The sanitizer removes `<tr-widget>` from anything an author writes, so
 *   every placeholder in the output came from this plugin.
 */

import { WIDGET_EMBED_MARKUP, encodeWidgetEmbed, parseWidgetEmbed, type IWidgetEmbed } from '@/types';

/**
 * The fields of an HTML syntax tree (hast) node this plugin reads and
 * writes. Declared here for the same reason as in `rehypeDemoteHeadings`:
 * the full `hast` types are not a declared dependency of this workspace.
 */
interface IHastNode {
    /** Node kind: `'element'`, `'text'`, `'root'`, and so on. */
    type: string;
    /** Tag name when `type` is `'element'`. */
    tagName?: string;
    /** Element properties, such as `className` or `dataEmbed`. */
    properties?: Record<string, unknown>;
    /** Text content when `type` is `'text'`. */
    value?: string;
    /** Child nodes, present on element and root nodes. */
    children?: IHastNode[];
}

/** The class the markdown converter gives a code block fenced as `widget`. */
const WIDGET_CODE_CLASS = `language-${WIDGET_EMBED_MARKUP.fenceLanguage}`;

/** Join the text of a node and its descendants. */
function textOf(node: IHastNode): string {
    return node.type === 'text' ? node.value ?? '' : (node.children ?? []).map(textOf).join('');
}

/**
 * Read the embed out of a `<pre><code class="language-widget">` block, or
 * return null when the node is not one or its body is not a valid embed.
 *
 * @param node - A direct child of the body.
 * @returns The checked embed, or null to leave the node as it is.
 */
function readEmbed(node: IHastNode): IWidgetEmbed | null {
    let result: IWidgetEmbed | null = null;
    const code = node.type === 'element' && node.tagName === 'pre'
        ? node.children?.find(child => child.type === 'element' && child.tagName === 'code')
        : undefined;
    const classNames = code?.properties?.className;
    if (code && Array.isArray(classNames) && classNames.includes(WIDGET_CODE_CLASS)) {
        try {
            result = parseWidgetEmbed(JSON.parse(textOf(code)));
        } catch {
            result = null;
        }
    }
    return result;
}

/**
 * Build the placeholder element for one embed.
 *
 * @param embed - The checked embed.
 * @returns An empty `<tr-widget>` element carrying the encoded embed and its type id.
 */
function placeholderFor(embed: IWidgetEmbed): IHastNode {
    return {
        type: 'element',
        tagName: WIDGET_EMBED_MARKUP.tagName,
        properties: {
            dataEmbed: encodeWidgetEmbed(embed),
            dataType: embed.type
        },
        children: []
    };
}

/**
 * Build the rehype transformer that replaces top-level ` ```widget ` blocks
 * with placeholders.
 *
 * @returns A transformer that changes the tree in place and returns it.
 */
export function rehypeWidgetEmbeds(): (tree: IHastNode) => IHastNode {
    /**
     * Replace each top-level widget block in one processed tree.
     *
     * @param tree - Root of the HTML syntax tree, after sanitizing.
     * @returns The same tree, with widget blocks replaced.
     */
    const transform = (tree: IHastNode): IHastNode => {
        if (tree.children) {
            tree.children = tree.children.map(child => {
                const embed = readEmbed(child);
                return embed ? placeholderFor(embed) : child;
            });
        }
        return tree;
    };
    return transform;
}
