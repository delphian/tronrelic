/**
 * @fileoverview Widget-type id of the embeddable token approval checker.
 *
 * The tools module registers the checker as a widget type under this id so
 * a CMS page can embed it with a ` ```widget ` block, and the frontend widget
 * registry keys the checker's component on the same string. One constant
 * keeps the two sides from drifting apart.
 */

/**
 * Widget-type id the tools module registers the token approval checker under.
 * Follows the `<owner-id>:<widget-name>` convention, with the tools module as
 * the owner.
 */
export const APPROVAL_CHECKER_WIDGET_TYPE_ID = 'tools:approval-checker';
