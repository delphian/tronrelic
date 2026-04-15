/**
 * Normalized block model representing a blockchain block.
 *
 * This is a provider-agnostic representation of a block on the TRON blockchain.
 * It contains only the core block data without any provider-specific fields or
 * transformation logic.
 */
export interface Block {
    /**
     * Block number (height) on the blockchain.
     */
    id: number;
}
