'use client';

/**
 * @fileoverview Shared state of one address page: which address, and which span.
 *
 * The server streams each section into the page as its own child, so no parent
 * component holds all the sections' data. The span selector writes the chosen
 * span here instead, and every span section reads it and refetches itself
 * when it changes.
 */

import { createContext, useContext } from 'react';
import type { AddressExplorerPeriod } from '@/types';

/** What every section of the page can read. */
export interface IAddressExplorerContextValue {
    /** The base58 address the page is about. */
    address: string;
    /** The span the visitor has chosen. */
    period: AddressExplorerPeriod;
    /** The span the server read the streamed sections over. */
    initialPeriod: AddressExplorerPeriod;
}

/** Provided by `AddressExplorerView`; null outside the page. */
export const AddressExplorerContext = createContext<IAddressExplorerContextValue | null>(null);

/**
 * Read the address page's shared state.
 *
 * @returns The page's address and spans.
 * @throws Error when used outside `AddressExplorerView`, which is a bug in how the page is put together.
 */
export function useAddressExplorer(): IAddressExplorerContextValue {
    const value = useContext(AddressExplorerContext);
    if (!value) {
        throw new Error('useAddressExplorer must be used inside AddressExplorerView');
    }
    return value;
}
