/**
 * @fileoverview `/a/<address>` — history and analytics for one TRON address.
 *
 * Every visitor gets the header, with the full address and a Tronscan link.
 * A signed-in visitor also gets the address's activity, streamed in section by
 * section as each chain read finishes; a signed-out visitor gets a sign-in
 * prompt instead. Signing in through that prompt refreshes this route, which
 * then renders the activity. The activity costs ClickHouse queries, which is
 * why it is gated, and the backend refuses it without a session anyway.
 *
 * The page is never indexed: it carries a `noindex` robots tag here and an
 * `X-Robots-Tag` header from `next.config.mjs`. It is deliberately left out of
 * `robots.txt`, because a crawler refused the URL there would never see the
 * `noindex` and could still list the bare URL.
 */

import { notFound } from 'next/navigation';
import type { Metadata } from 'next';
import { isValidTronAddress } from '../../../../../../lib/tronAddress';
import { Page } from '../../../../../../components/layout';
import { getServerSession } from '../../../../../../modules/user/lib/session-server';
import { getServerTranslator } from '../../../../../../modules/localization/server';
import { AddressExplorerHeader, AddressSignInPrompt } from '../../../../../../modules/address-explorer';
import { AddressExplorerStream } from '../../../../../../modules/address-explorer/server';

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

    return (
        <Page>
            <AddressExplorerHeader address={address} />
            {session
                ? <AddressExplorerStream address={address} />
                : <AddressSignInPrompt />}
        </Page>
    );
}
