/**
 * @fileoverview The signed-in body of `/a/<address>`, streamed section by section.
 *
 * A server component. It starts all five sections' chain reads at once, then
 * renders each section inside its own `Suspense` boundary. Next.js sends the
 * page with every section's placeholder straight away and streams each
 * section in as its read finishes, so the visitor sees the first section after
 * the fastest read instead of after the sum of all five.
 *
 * Everything inside the boundaries is the same client panels the browser keeps
 * up to date afterwards, so a streamed section and a refetched one render
 * identically.
 */

import { Suspense, type ReactNode } from 'react';
import type { AddressExplorerPeriod } from '@/types';
import { startAddressExplorerReads } from '../../api/addressExplorer.server';
import { AddressCounterpartiesPanel } from '../AddressCounterpartiesPanel';
import { AddressDelegationsPanel } from '../AddressDelegationsPanel';
import { AddressExplorerView } from '../AddressExplorerView';
import { AddressPermissionsPanel } from '../AddressPermissionsPanel';
import { AddressSectionPlaceholder } from '../AddressSectionPlaceholder';
import { AddressSummaryPanel } from '../AddressSummaryPanel';
import { AddressTransfersPanel } from '../AddressTransfersPanel';

/** The span the page opens on. */
const INITIAL_PERIOD: AddressExplorerPeriod = '7d';

/** Props for {@link AwaitSection}. */
interface IAwaitSectionProps<T> {
    /** A section's read in progress, started with the others so they run in parallel. */
    read: Promise<T>;
    /** Renders the section once its read finishes. */
    children: (section: T) => ReactNode;
}

/**
 * Wait for one section's read, then render it. Suspends its `Suspense`
 * boundary until then, which is what lets Next.js stream the section in on
 * its own.
 *
 * @param props - {@link IAwaitSectionProps}.
 * @returns The rendered section.
 */
async function AwaitSection<T>({ read, children }: IAwaitSectionProps<T>) {
    const section = await read;
    return <>{children(section)}</>;
}

/** Props for {@link AddressExplorerStream}. */
export interface IAddressExplorerStreamProps {
    /** The base58 address the page is about, already validated. */
    address: string;
}

/**
 * Render the signed-in body of the address page, streaming each section in
 * as its read finishes.
 *
 * @param props - {@link IAddressExplorerStreamProps}.
 * @returns The span selector and the five sections, each behind its own placeholder.
 */
export async function AddressExplorerStream({ address }: IAddressExplorerStreamProps) {
    const reads = await startAddressExplorerReads(address, INITIAL_PERIOD);

    return (
        <AddressExplorerView address={address} initialPeriod={INITIAL_PERIOD}>
            <Suspense fallback={<AddressSectionPlaceholder section="profile" />}>
                <AwaitSection read={reads.profile}>
                    {section => <AddressSummaryPanel initialSection={section} />}
                </AwaitSection>
            </Suspense>
            <Suspense fallback={<AddressSectionPlaceholder section="counterparties" />}>
                <AwaitSection read={reads.counterparties}>
                    {section => <AddressCounterpartiesPanel initialSection={section} />}
                </AwaitSection>
            </Suspense>
            <Suspense fallback={<AddressSectionPlaceholder section="transfers" />}>
                <AwaitSection read={reads.transfers}>
                    {section => <AddressTransfersPanel initialSection={section} />}
                </AwaitSection>
            </Suspense>
            <Suspense fallback={<AddressSectionPlaceholder section="delegations" />}>
                <AwaitSection read={reads.delegations}>
                    {section => <AddressDelegationsPanel initialSection={section} />}
                </AwaitSection>
            </Suspense>
            <Suspense fallback={<AddressSectionPlaceholder section="permissions" />}>
                <AwaitSection read={reads.permissions}>
                    {section => <AddressPermissionsPanel initialSection={section} />}
                </AwaitSection>
            </Suspense>
        </AddressExplorerView>
    );
}
