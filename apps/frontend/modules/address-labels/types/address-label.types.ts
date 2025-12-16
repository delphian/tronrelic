/**
 * Address label type definitions for frontend.
 *
 * These types mirror the backend IAddressLabel but are simplified
 * for frontend display purposes.
 */

/**
 * Label data returned from the API.
 */
export interface ILabelData {
    /** Human-readable label */
    label: string;

    /** Primary category (exchange, whale, contract, etc.) */
    category: string;

    /** Whether the label has been verified */
    verified?: boolean;

    /** Additional classification tags */
    tags?: string[];
}

/**
 * AddressLabel component props.
 */
export interface IAddressLabelProps {
    /** TRON address to display */
    address: string;

    /** Pre-resolved label data (SSR-friendly, avoids client fetch) */
    label?: ILabelData | null;

    /** Truncate address display (e.g., "TLyq...jKjxL") */
    truncate?: boolean;

    /** Show address alongside label */
    showAddress?: boolean;

    /** Link to TronScan on click */
    linkToExplorer?: boolean;

    /** Size variant */
    size?: 'sm' | 'md' | 'lg';

    /** Additional CSS class */
    className?: string;
}
