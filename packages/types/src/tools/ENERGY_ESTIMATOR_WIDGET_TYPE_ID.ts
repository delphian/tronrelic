/**
 * @fileoverview Widget-type id of the embeddable energy estimator.
 *
 * The tools module registers the estimator as a widget type under this id so
 * a CMS page can embed it with a ` ```widget ` block, and the frontend widget
 * registry keys the estimator's component on the same string. One constant
 * keeps the two sides from drifting apart.
 */

/**
 * Widget-type id the tools module registers the energy estimator under.
 * Follows the `<owner-id>:<widget-name>` convention, with the tools module as
 * the owner.
 */
export const ENERGY_ESTIMATOR_WIDGET_TYPE_ID = 'tools:energy-estimator';
