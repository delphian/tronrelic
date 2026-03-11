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
export {};
//# sourceMappingURL=IAddressLabel.js.map