/**
 * @fileoverview The query shape for finding addresses by the start of a tag.
 */

/**
 * Which assignments `getAddressesByTagPrefix` returns.
 *
 * A machine source can name a family of tags with a shared prefix, such as
 * `market:catfee:` for every role tag the rental markets pipeline writes for
 * CatFee. A prefix lookup finds every address in that family without
 * listing each tag, so a source does not have to write a second, broader tag
 * on every address just to make the family searchable.
 */
export interface IAddressTagPrefixQuery {
    /**
     * Text every returned tag starts with, matched from the start of the tag
     * and case-sensitively. End it with the family's separator, such as the
     * colon in `market:catfee:`, or it also matches a longer name that starts
     * the same way (`market:catfee-pro:`).
     */
    prefix: string;
    /** Most assignments returned; the service clamps it to its list limits. */
    limit?: number;
}
