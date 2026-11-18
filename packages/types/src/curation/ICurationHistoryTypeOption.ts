/**
 * @fileoverview One content type the History tab's type filter can offer.
 */

/**
 * A content type that has at least one decided item, named for the filter.
 *
 * The list comes from the decided items rather than from the registered types,
 * so a type whose plugin was later removed can still be filtered, and a type
 * that has never been decided is not offered as a filter that matches nothing.
 */
export interface ICurationHistoryTypeOption {
    /** The namespaced content type id the filter sends back, such as `x-poster:tweet`. */
    typeId: string;

    /**
     * The registered type's label, such as "Tweet". A type that is no longer
     * registered has no label, so its id stands in for one.
     */
    label: string;
}
