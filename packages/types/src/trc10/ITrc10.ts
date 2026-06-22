/**
 * Source-agnostic contract for a TRON TRC10 token (an on-chain "asset issue").
 *
 * Why this exists: TronRelic must record and render TRC10 tokens without binding
 * the rest of the platform to TronGrid's wire shape. Every field below is an
 * on-chain property of the asset — the kind of fact any block provider (a
 * non-TronGrid node, a MySQL/ClickHouse mirror, an archival indexer) must be
 * able to supply by obligation. There is no provider envelope, no `any`, and no
 * field that only one source could populate. A consumer depends on this
 * interface; the producer (a `getTrc10` helper) owns the mapping from whatever
 * raw form the source returns. See docs/system/system-domain-types.md for the
 * admission test this type is built to pass.
 *
 * Units and encoding are normalized so consumers never re-decode: addresses are
 * Base58, names/text are decoded UTF-8, amounts are plain numbers in the token's
 * own base units, and timestamps are epoch-milliseconds. TRX is explicitly out of
 * scope — TRX is the native coin, not a TRC10 asset, and is never represented by
 * this type.
 *
 * Optionality follows the chain, not convenience. TRC10 is defined by a proto3
 * `AssetIssueContract`, where every field is optional-by-default and an absent
 * scalar is indistinguishable from its zero value — an omitted `precision` and a
 * `precision` of 0 are the same fact on-chain, an omitted `description` and an
 * empty one are the same bytes. Fields are therefore required with honest
 * zero/empty values rather than `T | null`: a nullable would fabricate an
 * "unset vs zero" distinction the blockchain does not carry, and a non-TronGrid
 * backend (SQL, ClickHouse) could not honor it by obligation. The only field
 * that can be legitimately absent is the chain-assigned id of an unconfirmed or
 * non-asset record — the mapper rejects those before an `ITrc10` is produced.
 */

/**
 * One issuer-locked supply tranche declared at asset creation.
 *
 * Why a caller needs it: the frozen supply is part of a token's published
 * tokenomics — it tells holders how much of the total the issuer committed to
 * lock and for how long. Modeled as a list because the chain permits multiple
 * tranches with independent durations.
 */
export interface ITrc10FrozenSupply {
    /** Token amount (base units) the issuer locked in this tranche. */
    frozenAmount: number;
    /** Number of days the tranche stays locked from issuance. */
    frozenDays: number;
}

/**
 * A fully-resolved TRC10 token as it exists on the TRON blockchain.
 *
 * Why a caller needs it: this is the unit the platform stores when it detects a
 * token creation and the unit it renders on token pages. The chain-assigned
 * {@link ITrc10.tokenId} is the load-bearing field — it is the identifier every
 * explorer link and follow-up lookup uses, and it is the one fact the creation
 * transaction alone does not carry, which is why resolution against a provider
 * is mandatory rather than optional.
 */
export interface ITrc10 {
    /** Chain-assigned numeric asset id, as a string (e.g. "1004777"). The canonical key. */
    tokenId: string;
    /** Base58 address of the account that issued the token. One token per account on TRON. */
    ownerAddress: string;
    /** Decoded UTF-8 token name. */
    name: string;
    /** Decoded UTF-8 ticker/abbreviation. */
    abbreviation: string;
    /** Decoded UTF-8 project description; empty string when the issuer set none. */
    description: string;
    /** Project URL; empty string when the issuer set none. */
    url: string;
    /** Total issued supply in the token's base units. */
    totalSupply: number;
    /** Decimal places the token uses for display; 0 when the chain left it unset. */
    precision: number;
    /** ICO exchange rate numerator: tokens received per {@link ITrc10.icoTrxNum} SUN during the sale. */
    icoNumTokens: number;
    /** ICO exchange rate denominator in SUN; pairs with {@link ITrc10.icoNumTokens}. */
    icoTrxNum: number;
    /** ICO sale window start as epoch-ms; 0 when the chain left it unset. */
    saleStart: number;
    /** ICO sale window end as epoch-ms; 0 when the chain left it unset. */
    saleEnd: number;
    /** Issuer-locked supply tranches; empty array when none were declared. */
    frozenSupply: ITrc10FrozenSupply[];
    /** Per-account free bandwidth the token grants its holders. */
    freeAssetNetLimit: number;
    /** Network-wide free bandwidth pool the token funds. */
    publicFreeAssetNetLimit: number;
    /** On-chain vote score for the asset; 0 when absent. */
    voteScore: number;
}
