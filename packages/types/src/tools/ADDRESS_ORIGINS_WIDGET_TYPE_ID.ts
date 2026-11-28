/**
 * @fileoverview Widget-type id of the embeddable Address Origins tracer.
 *
 * The tools module registers the tracer as a widget type under this id so a
 * CMS page can embed it with a ` ```widget ` block, and the frontend widget
 * registry keys the tracer's component on the same string. One constant keeps
 * the two sides from drifting apart.
 */

/**
 * Widget-type id the tools module registers Address Origins under. Follows
 * the `<owner-id>:<widget-name>` convention, with the tools module as the
 * owner.
 */
export const ADDRESS_ORIGINS_WIDGET_TYPE_ID = 'tools:address-origins';
