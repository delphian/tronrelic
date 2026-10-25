/**
 * @fileoverview What a machine source says one of its tags means.
 */

/**
 * One tag's meaning, written by the machine source that asserts the tag.
 *
 * A tag's text is short and easy to misread. `market:catfee:pool-wallet`
 * reads as "CatFee's pool wallet" to a person or a model, when the source
 * only means that the address was seen taking part in CatFee's market in
 * that role. Without a stated meaning, every reader has to guess from the
 * text. A source passes its definitions to `syncDefinitions`, and readers
 * such as the AI tools return the meaning beside the tag, so the source's
 * own words reach whoever reads the tag.
 */
export interface IAddressTagDefinition {
    /** The exact tag text being defined, such as `market:catfee:pool-wallet`. */
    tag: string;
    /**
     * What the tag says about an address that carries it, in plain sentences
     * a reader can rely on without knowing the source. State what was
     * observed and what the tag does not claim.
     */
    meaning: string;
}
