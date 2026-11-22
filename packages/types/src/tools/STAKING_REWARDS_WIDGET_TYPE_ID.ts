/**
 * @fileoverview Widget-type id of the embeddable staking rewards calculator.
 *
 * The tools module registers the calculator as a widget type under this id so
 * a CMS page can embed it with a ` ```widget ` block, and the frontend widget
 * registry keys the calculator's component on the same string. One constant
 * keeps the two sides from drifting apart.
 */

/**
 * Widget-type id the tools module registers the staking rewards calculator
 * under, following the `<owner-id>:<widget-name>` convention.
 */
export const STAKING_REWARDS_WIDGET_TYPE_ID = 'tools:staking-rewards';
