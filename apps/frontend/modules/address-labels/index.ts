/**
 * Address Labels Module
 *
 * Frontend module for displaying blockchain address labels.
 * Provides components, API client functions, and types for
 * human-readable address identification.
 *
 * @example
 * ```tsx
 * import { AddressLabel, prefetchLabels } from '@/modules/address-labels';
 *
 * // Display a labeled address
 * <AddressLabel address="TLyqzVGLV1srkB7dToTAEqgDSfPtXRJZYH" />
 *
 * // Prefetch labels for a list of addresses
 * const labels = await prefetchLabels(addresses);
 * ```
 */

// Components
export { AddressLabel } from './components';

// API client functions
export {
    fetchLabel,
    prefetchLabels,
    clearLabelCache,
    isLabelCached,
    getCachedLabel
} from './api';

// Types
export type { ILabelData, IAddressLabelProps } from './types';
