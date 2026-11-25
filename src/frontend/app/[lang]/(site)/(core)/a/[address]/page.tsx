/**
 * @fileoverview `/a/<address>` — history and analytics for one TRON address.
 *
 * Every visitor gets the header, with the full address and a Tronscan link.
 * A signed-in visitor also gets the address's activity, fetched here on the
 * server so it arrives with the page; a signed-out visitor gets a sign-in
 * prompt instead. Signing in through that prompt refreshes this route, which
 * then renders the activity. The activity costs ClickHouse queries, which is
 * why it is gated, and the backend refuses it without a session anyway.
 *
 * The page is never indexed: it carries a `noindex` robots tag here and an
 * `X-Robots-Tag` header from `next.config.mjs`. It is deliberately left out of
 * `robots.txt`, because a crawler refused the URL there would never see the
 * `noindex` and could still list the bare URL.
 */

import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import type { IAddressExplorerOverview } from '@/types';
import { getServerSideApiUrlWithPath } from '../../../../../../lib/api-url';
import { isValidTronAddress } from '../../../../../../lib/tronAddress';
import { Page } from '../../../../../../components/layout';
import { getServerSession } from '../../../../../../modules/user/lib/session-server';
import { getServerTranslator } from '../../../../../../modules/localization/server';
import { AddressExplorerHeader, AddressExplorerView, AddressSignInPrompt } from '../../../../../../modules/address-explorer';

/** Route parameters of the page. */
interface IAddressPageParams {
    lang: string;
    address: string;
}

/**
 * Shorten an address for the browser tab title, where the full 34 characters
 * would push the site name out of view.
 *
 * @param address - The base58 address.
 * @returns The first six and last four characters.
 */
function shortAddress(address: string): string {
    return `${address.slice(0, 6)}…${address.slice(-4)}`;
}

/**
 * Build the page's metadata: a title naming the address, and no indexing.
 *
 * @param props - Route props; `params.lang` selects the title's language.
 * @returns The metadata.
 */
export async function generateMetadata({ params }: { params: Promise<IAddressPageParams> }): Promise<Metadata> {
    const [{ t }, { address }] = await Promise.all([getServerTranslator(params), params]);
    return {
        title: t('addressExplorer.meta.title', 'Address {address}', { address: shortAddress(address) }),
        robots: { index: false, follow: false }
    };
}

/**
 * Fetch the address page's sections during the server render, forwarding the
 * visitor's cookie so the backend's login gate sees their session. A failure
 * returns null, and the view then offers a retry instead of breaking the page.
 *
 * @param address - The base58 address.
 * @returns The overview, or null when the request failed.
 */
async function fetchInitialOverview(address: string): Promise<IAddressExplorerOverview | null> {
    let overview: IAddressExplorerOverview | null = null;
    try {
        const cookie = (await headers()).get('cookie');
        const response = await fetch(`${getServerSideApiUrlWithPath()}/address-explorer/${encodeURIComponent(address)}?period=7d`, {
            headers: cookie ? { Cookie: cookie } : undefined,
            cache: 'no-store'
        });
        if (response.ok) {
            const body = await response.json() as { overview?: IAddressExplorerOverview };
            overview = body.overview ?? null;
        }
    } catch {
        overview = null;
    }
    return overview;
}

/**
 * Address page server component.
 *
 * @param props - Route props; `params.address` is the address from the URL.
 * @returns The page for a valid address; an invalid one renders the 404 page.
 */
export default async function AddressPage({ params }: { params: Promise<IAddressPageParams> }) {
    const { address } = await params;
    if (!isValidTronAddress(address)) {
        notFound();
    }
    const session = await getServerSession();
    const overview = session ? await fetchInitialOverview(address) : null;

    return (
        <Page>
            <AddressExplorerHeader address={address} />
            {session
                ? <AddressExplorerView address={address} initialOverview={overview} />
                : <AddressSignInPrompt />}
        </Page>
    );
}
