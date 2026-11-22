/**
 * @fileoverview Menu namespace of the `/system/tools` tab row.
 *
 * The tools module registers the page's tabs as menu nodes in this namespace
 * (the menu module's Submenu Pattern), and the admin page reads the same
 * namespace to draw them. One constant keeps the two sides in step.
 */

/** Menu namespace holding the `/system/tools` tab nodes. */
export const TOOLS_ADMIN_SUBMENU_NAMESPACE = 'tools-admin';
