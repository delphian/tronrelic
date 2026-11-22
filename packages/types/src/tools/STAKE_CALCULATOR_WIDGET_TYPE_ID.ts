/**
 * @fileoverview Widget-type id of the embeddable stake calculator.
 *
 * The tools module registers the calculator as a widget type under this id so
 * a CMS page can embed it with a ` ```widget ` block, and the frontend widget
 * registry keys the calculator's component on the same string. One constant
 * keeps the two sides from drifting apart.
 */

/**
 * Widget-type id the tools module registers the stake calculator under.
 * Follows the `<owner-id>:<widget-name>` convention, with the tools module as
 * the owner.
 */
export const STAKE_CALCULATOR_WIDGET_TYPE_ID = 'tools:stake-calculator';
