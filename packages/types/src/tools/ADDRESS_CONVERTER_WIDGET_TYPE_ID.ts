/**
 * @fileoverview Widget-type id of the embeddable address converter.
 *
 * The tools module registers the converter as a widget type under this id so
 * a CMS page can embed it with a ` ```widget ` block, and the frontend widget
 * registry keys the converter's component on the same string. One constant
 * keeps the two sides from drifting apart.
 */

/**
 * Widget-type id the tools module registers the address converter under.
 * Follows the `<owner-id>:<widget-name>` convention, with the tools module as
 * the owner.
 */
export const ADDRESS_CONVERTER_WIDGET_TYPE_ID = 'tools:address-converter';
