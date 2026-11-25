'use client';

/**
 * @fileoverview Keeps one span section of the address page in step with the chosen span.
 *
 * Each section starts from the data the server streamed and refetches only
 * itself when the visitor picks another span or presses its retry, so the
 * sections load in parallel and each updates as soon as its own data arrives.
 * A section that streamed in after the visitor had already changed the span
 * notices the difference and refetches straight away.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type {
    AddressExplorerPeriod,
    AddressExplorerSection,
    AddressExplorerSpanSection,
    IAddressExplorerSpanSections
} from '@/types';
import { fetchAddressSpanSection } from '../api/addressExplorer.api';
import { useAddressExplorer } from './useAddressExplorer';

/** What {@link useSpanSection} gives the section's panel. */
export interface IUseSpanSectionResult<T> {
    /** The section to render: the streamed one, or the latest refetch. */
    section: AddressExplorerSection<T>;
    /** True while a refetch is in flight; the panel dims its old figures meanwhile. */
    loading: boolean;
    /** Read the section again over the current span, for its retry button. */
    retry: () => void;
}

/**
 * Hold a span section and refetch it whenever the chosen span moves away from
 * the span it was read over.
 *
 * @param name - Which section this is.
 * @param initialSection - The section the server streamed, read over the page's initial span.
 * @returns The section, whether a refetch is running, and a retry.
 */
export function useSpanSection<K extends AddressExplorerSpanSection>(
    name: K,
    initialSection: AddressExplorerSection<IAddressExplorerSpanSections[K]>
): IUseSpanSectionResult<IAddressExplorerSpanSections[K]> {
    const { address, period, initialPeriod } = useAddressExplorer();
    const [section, setSection] = useState(initialSection);
    const [loadedPeriod, setLoadedPeriod] = useState<AddressExplorerPeriod>(initialPeriod);
    const [loading, setLoading] = useState(false);
    // Numbers each read, so the answer to a read the visitor has already moved
    // on from (a span picked and then changed again) is thrown away.
    const requestRef = useRef(0);

    /**
     * Read the section over a span and show it, unless a newer read has
     * started since. A failed request shows as a failed section with a retry.
     *
     * @param target - The span to read.
     */
    const load = useCallback(async (target: AddressExplorerPeriod) => {
        requestRef.current += 1;
        const request = requestRef.current;
        setLoading(true);
        let next: AddressExplorerSection<IAddressExplorerSpanSections[K]>;
        try {
            next = await fetchAddressSpanSection(address, name, target);
        } catch {
            next = { status: 'error', reason: 'failed' };
        }
        if (request === requestRef.current) {
            setSection(next);
            setLoadedPeriod(target);
            setLoading(false);
        }
    }, [address, name]);

    /**
     * Refetch when the chosen span differs from the span on screen. When the
     * visitor returns to the span already on screen, drop any read still in
     * flight for the span they left.
     */
    useEffect(() => {
        if (period !== loadedPeriod) {
            void load(period);
        } else {
            requestRef.current += 1;
            setLoading(false);
        }
    }, [period, loadedPeriod, load]);

    /** Read the section again over the current span. */
    const retry = useCallback(() => {
        void load(period);
    }, [load, period]);

    return { section, loading, retry };
}
