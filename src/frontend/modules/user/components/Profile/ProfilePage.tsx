/**
 * Profile page server component.
 *
 * Fetches profile data during SSR and renders either the owner view or
 * the public view. Ownership is decided server-side: the SSR fetch
 * forwards the visitor's `tronrelic_uid` cookie to the backend, which
 * compares it against the profile's owning UUID and returns
 * `isOwner: boolean` in the payload. The owning UUID itself never crosses
 * the wire, so a public profile lookup cannot be used as a
 * wallet-address → UUID oracle.
 *
 * Public profiles only exist for wallet addresses whose owning user is in
 * the *verified* identity state — i.e. the wallet has `verified: true`.
 * Returns 404 for registered (unsigned) wallets and unknown addresses.
 *
 * Follows SSR + Live Updates pattern: data is fetched on server and passed
 * to client components as props. No loading spinners for initial content.
 */

import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { USER_ID_COOKIE_NAME } from '../../lib/identity';
import type { IPublicProfile } from '../../api';
import { ProfileOwnerView } from './ProfileOwnerView';
import { ProfilePublicView } from './ProfilePublicView';

/**
 * Props for the ProfilePage component.
 */
interface ProfilePageProps {
    address: string;
}

/**
 * Fetch profile from backend API during SSR, forwarding the visitor's
 * identity cookie so the backend can compute `isOwner` server-side.
 *
 * @param address - TRON wallet address
 * @param uidCookieValue - The visitor's `tronrelic_uid` cookie value, if any
 * @returns Profile data or null if not found
 */
async function fetchProfile(address: string, uidCookieValue: string | null): Promise<IPublicProfile | null> {
    try {
        const backendUrl = process.env.SITE_BACKEND || 'http://localhost:4000';
        const response = await fetch(`${backendUrl}/api/profile/${address}`, {
            headers: uidCookieValue
                ? { Cookie: `${USER_ID_COOKIE_NAME}=${uidCookieValue}` }
                : {},
            cache: 'no-store'
        });

        if (response.status === 404) {
            return null;
        }

        if (!response.ok) {
            throw new Error(`Failed to fetch profile: ${response.status}`);
        }

        return response.json();
    } catch (error) {
        console.error('Error fetching profile:', error);
        return null;
    }
}

/**
 * ProfilePage server component.
 *
 * Fetches profile data during SSR and renders either the owner view or
 * the public view based on the backend-computed `isOwner` flag.
 *
 * Data is passed to client components as props - no client-side fetching
 * for initial page content.
 */
export async function ProfilePage({ address }: ProfilePageProps): Promise<JSX.Element> {
    // Forward the visitor's identity cookie so the backend can compute isOwner.
    const cookieStore = await cookies();
    const uidCookieValue = cookieStore.get(USER_ID_COOKIE_NAME)?.value ?? null;

    const profile = await fetchProfile(address, uidCookieValue);

    // Return 404 if profile doesn't exist (wallet is registered or unknown)
    if (!profile) {
        notFound();
    }

    // Render appropriate view - data passed as props (SSR pattern)
    if (profile.isOwner) {
        return <ProfileOwnerView profile={profile} />;
    }

    return <ProfilePublicView profile={profile} />;
}
