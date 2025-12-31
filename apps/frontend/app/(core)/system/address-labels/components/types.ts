/**
 * Shared types for address labels admin components.
 */

/**
 * Address label data from the API.
 */
export interface AddressLabel {
    address: string;
    label: string;
    category: string;
    tags: string[];
    source: string;
    sourceType: string;
    confidence: number;
    verified: boolean;
    tronMetadata?: {
        superRepresentative?: boolean;
        energyProvider?: boolean;
        contractType?: string;
        tokenSymbol?: string;
        tokenName?: string;
    };
    notes?: string;
    createdAt: string;
    updatedAt: string;
}

/**
 * Statistics from the API.
 */
export interface LabelStats {
    total: number;
    byCategory: Record<string, number>;
    bySourceType: Record<string, number>;
    verified: number;
    unverified: number;
}

/**
 * Create label form state.
 */
export interface CreateLabelFormState {
    address: string;
    label: string;
    category: string;
    tags: string;
    source: string;
    sourceType: string;
    confidence: number;
    verified: boolean;
    notes: string;
}

/**
 * Import result from the API.
 */
export interface ImportResult {
    imported: number;
    updated: number;
    failed: number;
    errors: { address: string; error: string }[];
}

/**
 * Category options for the select dropdown.
 */
export const CATEGORIES = [
    { value: 'exchange', label: 'Exchange' },
    { value: 'whale', label: 'Whale' },
    { value: 'contract', label: 'Contract' },
    { value: 'institution', label: 'Institution' },
    { value: 'risk', label: 'Risk' },
    { value: 'user', label: 'User' },
    { value: 'unknown', label: 'Unknown' }
];

/**
 * Source type options.
 */
export const SOURCE_TYPES = [
    { value: 'system', label: 'System' },
    { value: 'user', label: 'User' },
    { value: 'plugin', label: 'Plugin' },
    { value: 'import', label: 'Import' }
];
