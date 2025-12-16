/**
 * Address labels API client.
 *
 * Provides functions for fetching address labels from the backend API
 * with in-memory caching and request deduplication.
 */

import type { ILabelData } from '../types';

/**
 * In-memory cache for label lookups.
 */
const labelCache = new Map<string, ILabelData | null>();

/**
 * Pending requests to avoid duplicate fetches.
 */
const pendingRequests = new Map<string, Promise<ILabelData | null>>();

/**
 * Fetch label for an address with caching and deduplication.
 *
 * @param address - TRON address to look up
 * @returns Label data or null if not found
 */
export async function fetchLabel(address: string): Promise<ILabelData | null> {
    // Check cache first
    if (labelCache.has(address)) {
        return labelCache.get(address) || null;
    }

    // Check for pending request
    const pending = pendingRequests.get(address);
    if (pending) {
        return pending;
    }

    // Create new request
    const request = (async () => {
        try {
            const response = await fetch(`/api/address-labels/${encodeURIComponent(address)}`);

            if (!response.ok) {
                labelCache.set(address, null);
                return null;
            }

            const data = await response.json();
            const labelData: ILabelData = {
                label: data.label.label,
                category: data.label.category,
                verified: data.label.verified,
                tags: data.label.tags
            };

            labelCache.set(address, labelData);
            return labelData;
        } catch {
            labelCache.set(address, null);
            return null;
        } finally {
            pendingRequests.delete(address);
        }
    })();

    pendingRequests.set(address, request);
    return request;
}

/**
 * Prefetch labels for multiple addresses.
 *
 * Useful for SSR or batch loading in transaction lists.
 *
 * @param addresses - Array of TRON addresses to prefetch
 * @returns Map of address to label data
 */
export async function prefetchLabels(addresses: string[]): Promise<Map<string, ILabelData | null>> {
    const result = new Map<string, ILabelData | null>();
    const uncached = addresses.filter(addr => !labelCache.has(addr));

    if (uncached.length > 0) {
        try {
            const response = await fetch('/api/address-labels/bulk', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ addresses: uncached })
            });

            if (response.ok) {
                const data = await response.json();
                for (const [address, labelData] of Object.entries(data.labels)) {
                    const label = labelData as ILabelData | null;
                    labelCache.set(address, label);
                }
            }
        } catch {
            // Ignore errors, labels will be fetched individually
        }
    }

    for (const address of addresses) {
        result.set(address, labelCache.get(address) || null);
    }

    return result;
}

/**
 * Clear the label cache.
 *
 * Useful when labels are updated via admin UI.
 */
export function clearLabelCache(): void {
    labelCache.clear();
}

/**
 * Check if an address has a cached label.
 *
 * @param address - TRON address to check
 * @returns True if label is cached (even if null)
 */
export function isLabelCached(address: string): boolean {
    return labelCache.has(address);
}

/**
 * Get a cached label without fetching.
 *
 * @param address - TRON address to look up
 * @returns Cached label or undefined if not cached
 */
export function getCachedLabel(address: string): ILabelData | null | undefined {
    return labelCache.get(address);
}
