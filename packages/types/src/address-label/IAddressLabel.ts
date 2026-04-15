/**
 * Address label data model.
 *
 * Represents metadata associated with a TRON blockchain address, enabling
 * human-readable identification of wallets, contracts, and entities.
 *
 * ## Design Decisions
 *
 * - **Multi-source support**: Same address can have labels from different sources
 *   (system, user, plugin, import) with confidence-based resolution
 * - **TRON-specific metadata**: Optional fields for SR status, energy providers,
 *   and contract types unique to TRON ecosystem
 * - **Extensibility**: customMetadata field allows arbitrary key-value pairs
 *   for specialized use cases
 */

/**
 * Primary categories for blockchain addresses.
 *
 * Categories provide high-level classification for filtering and display.
 * Use tags for more granular classification within categories.
 */
export type AddressCategory =
    | 'exchange'           // Centralized or decentralized exchanges
    | 'whale'              // High-value wallets (identified or anonymous)
    | 'contract'           // Smart contracts (DeFi, token, NFT, etc.)
    | 'institution'        // Super representatives, foundations, energy providers
    | 'risk'               // Scam, phishing, sanctioned addresses
    | 'user'               // Individual user wallets
    | 'unknown';           // Unclassified addresses

/**
 * Source types for address labels.
 *
 * Determines the origin and authority level of a label:
 * - system: Core platform labels (exchanges, known contracts)
 * - user: User-submitted labels (requires moderation in future)
 * - plugin: Labels contributed by plugins
 * - import: Bulk imported from external sources
 */
export type AddressLabelSourceType = 'system' | 'user' | 'plugin' | 'import';

/**
 * TRON-specific metadata for blockchain addresses.
 *
 * Captures TRON ecosystem characteristics that don't apply to other chains.
 */
export interface ITronAddressMetadata {
    /** Whether this address is a Super Representative */
    superRepresentative?: boolean;

    /** Whether this address provides energy in the marketplace */
    energyProvider?: boolean;

    /** Type of smart contract if applicable */
    contractType?: 'trc20' | 'trc721' | 'dex' | 'lending' | 'bridge' | 'other';

    /** Token symbol if this is a token contract */
    tokenSymbol?: string;

    /** Token name if this is a token contract */
    tokenName?: string;
}

/**
 * Address label public interface.
 *
 * Represents the public API view of an address label, suitable for
 * API responses and frontend display. Does not include MongoDB _id.
 */
export interface IAddressLabel {
    /** TRON address (base58 format starting with T) */
    address: string;

    /** Human-readable label (e.g., "Binance Hot Wallet 1") */
    label: string;

    /** Primary category for classification */
    category: AddressCategory;

    /** Additional classification tags (e.g., ["cex", "hot-wallet"]) */
    tags: string[];

    /** Source identifier (e.g., "tronscan", "user:uuid", "plugin:whale-alerts") */
    source: string;

    /** Type of source for filtering and priority */
    sourceType: AddressLabelSourceType;

    /** Confidence score 0-100 (higher = more reliable) */
    confidence: number;

    /** Whether this label has been manually verified */
    verified: boolean;

    /** TRON-specific metadata */
    tronMetadata?: ITronAddressMetadata;

    /** Additional context or notes */
    notes?: string;

    /** Extensible metadata for specialized use cases */
    customMetadata?: Record<string, unknown>;

    /** When the label was created */
    createdAt: Date;

    /** When the label was last updated */
    updatedAt: Date;
}

/**
 * Resolved label result from conflict resolution.
 *
 * When multiple sources label the same address, the system picks the
 * highest-confidence label and includes alternate labels for transparency.
 */
export interface IResolvedAddressLabel {
    /** The primary (highest confidence) label */
    primary: IAddressLabel;

    /** Alternative labels from other sources (sorted by confidence desc) */
    alternates: IAddressLabel[];
}
