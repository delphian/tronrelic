/**
 * @fileoverview Widget-type id of the embeddable address generator.
 *
 * The tools module registers the generator as a widget type under this id so
 * a CMS page can embed it with a ` ```widget ` block, and the frontend widget
 * registry keys the generator's component on the same string. One constant
 * keeps the two sides from drifting apart.
 */

/**
 * Widget-type id the tools module registers the address generator under.
 * Follows the `<owner-id>:<widget-name>` convention, with the tools module as
 * the owner.
 */
export const ADDRESS_GENERATOR_WIDGET_TYPE_ID = 'tools:address-generator';
