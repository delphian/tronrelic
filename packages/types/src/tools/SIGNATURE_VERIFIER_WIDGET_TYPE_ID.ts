/**
 * @fileoverview Widget-type id of the embeddable signature verifier.
 *
 * The tools module registers the verifier as a widget type under this id so
 * a CMS page can embed it with a ` ```widget ` block, and the frontend widget
 * registry keys the verifier's component on the same string. One constant
 * keeps the two sides from drifting apart.
 */

/**
 * Widget-type id the tools module registers the signature verifier under.
 * Follows the `<owner-id>:<widget-name>` convention, with the tools module as
 * the owner.
 */
export const SIGNATURE_VERIFIER_WIDGET_TYPE_ID = 'tools:signature-verifier';
