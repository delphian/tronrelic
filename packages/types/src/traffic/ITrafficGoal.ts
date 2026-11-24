/**
 * @fileoverview One goal event as a component reports it to the traffic module.
 *
 * Why it exists: a goal is something a visitor did that counts as a result for
 * the site, such as following a link to a rental market. The component that
 * owns the action decides what the goal means, and the traffic module records
 * it against the visitor so it can be attributed to the session's source and
 * landing page with the same rules as every other traffic figure. This shape is
 * what passes between the two.
 *
 * Rules the traffic module enforces when recording:
 * - `name` is `<owner>:<action>`, lower-case letters, digits, and hyphens on each
 *   side, at most 64 characters, such as `resource-markets:outbound-click`.
 * - `properties` holds at most 8 entries. Each key is lower-case letters, digits,
 *   and underscores, starting with a letter, at most 32 characters. Each value
 *   is at most 128 characters.
 * - Anything else is refused with an error, so a mistake surfaces in the
 *   caller's tests rather than as a silently missing figure.
 */

/**
 * A goal the visitor reached, with the details its owner wants to group by.
 */
export interface ITrafficGoal {
    /**
     * Which goal this is, namespaced by the owning component so two components
     * can never report the same name for different actions.
     */
    name: string;

    /**
     * Details the owner wants to break the goal down by later, such as which
     * market a link pointed at and where on the page it was. Values are
     * stored as text and returned as written. Never put a secret, an email
     * address, or a wallet the visitor owns in here.
     */
    properties?: Record<string, string>;
}
