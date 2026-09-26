/**
 * @fileoverview JSON Schema `format` that marks a widget setting as a
 * lucide-react icon name.
 *
 * A widget type declares its settings as JSON Schema, and the placement
 * form on `/system/widgets` builds its controls from that schema. A plain
 * string property renders as a text input, which leaves the operator
 * typing icon names from memory. Declaring `format: WIDGET_ICON_FORMAT.name`
 * on the property tells the form to render the icon picker instead, and
 * tells the placements API to reject a value that cannot be an icon name.
 * Both sides import the name and pattern from here so they cannot drift.
 */

/**
 * Name and shape of the icon-name format.
 *
 * `name` is the value a schema puts in `format`. `pattern` is the source of
 * the regular expression the placements API registers under that name: a
 * lucide export name is PascalCase letters and digits, such as `Wallet` or
 * `ArrowLeftRight`. Whether the name exists in the installed lucide version
 * is checked at render time, where an unknown name renders no icon.
 */
export const WIDGET_ICON_FORMAT: {
    readonly name: string;
    readonly pattern: string;
} = {
    name: 'lucide-icon',
    pattern: '^[A-Z][A-Za-z0-9]*$'
};
