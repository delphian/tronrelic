/**
 * @fileoverview JSON Schema `format` that marks a widget setting as the name
 * of a menu namespace.
 *
 * A widget type declares its settings as JSON Schema, and the placement
 * form on `/system/widgets` builds its controls from that schema. A plain
 * string property renders as a text input, which leaves the operator typing
 * namespace names from memory. Declaring `format: WIDGET_MENU_NAMESPACE_FORMAT.name`
 * on the property tells the form to render a dropdown of the namespaces the
 * menu service currently holds, and tells the placements API to reject a
 * value that cannot be a namespace name. Both sides import the name and
 * pattern from here so they cannot drift.
 */

/**
 * Name and shape of the menu-namespace format.
 *
 * `name` is the value a schema puts in `format`. `pattern` is the source of
 * the regular expression the placements API registers under that name. It
 * matches the rule the menu API applies to namespace names: lowercase
 * letters, digits, and hyphens, starting with a letter, at most 64
 * characters. Whether the namespace has any nodes is not checked here; a
 * namespace with none renders an empty menu.
 */
export const WIDGET_MENU_NAMESPACE_FORMAT: {
    readonly name: string;
    readonly pattern: string;
} = {
    name: 'menu-namespace',
    pattern: '^[a-z][a-z0-9-]{0,63}$'
};
