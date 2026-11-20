/**
 * @fileoverview Rehype plugin that shifts every heading in an HTML tree down
 * one level.
 *
 * A page that renders its own title as the only `<h1>`, such as a blog post,
 * cannot also show a body whose markdown opens with `# Heading`, or the page
 * ends up with two `<h1>` elements and a broken outline. The renderer applies
 * this plugin when a caller sets `demoteHeadings`.
 */

/**
 * The few fields of an HTML syntax tree (hast) node the walk reads. Declared
 * here because the full `hast` types are not a declared dependency of this
 * workspace, and one tag rename does not justify adding them.
 */
interface IHastNode {
    /** Node kind: `'element'` for tags, `'text'`, `'root'`, and so on otherwise. */
    type: string;
    /** Tag name when `type` is `'element'`, such as `'h1'` or `'p'`. */
    tagName?: string;
    /** Child nodes, present on element and root nodes. */
    children?: IHastNode[];
}

/** Matches the heading tags that have a lower level to move to; h6 has none. */
const DEMOTABLE_HEADING = /^h[1-5]$/;

/**
 * Rename one node's heading tag down a level, then visit its children.
 *
 * @param node - The node to visit. Changed in place.
 */
function demoteNode(node: IHastNode): void {
    if (node.type === 'element' && node.tagName && DEMOTABLE_HEADING.test(node.tagName)) {
        node.tagName = `h${Number(node.tagName.slice(1)) + 1}`;
    }
    node.children?.forEach(demoteNode);
}

/**
 * Build the rehype transformer that demotes every heading in the tree.
 *
 * Unified calls a plugin function once to get its transformer, then runs the
 * transformer on each tree it processes.
 *
 * @returns A transformer that changes the tree in place and returns it.
 */
export function rehypeDemoteHeadings(): (tree: IHastNode) => IHastNode {
    /**
     * Demote every heading in one processed tree.
     *
     * @param tree - Root of the HTML syntax tree.
     * @returns The same tree, after its headings are renamed.
     */
    const transform = (tree: IHastNode): IHastNode => {
        demoteNode(tree);
        return tree;
    };
    return transform;
}
