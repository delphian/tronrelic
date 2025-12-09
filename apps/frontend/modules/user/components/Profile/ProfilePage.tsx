/**
 * Profile page server component.
 *
 * Fetches profile data during SSR and determines whether to show
 * the owner view (control panel) or public view based on cookie comparison.
 *
 * The profile only exists for verified wallet addresses - returns 404 for
 * unverified or non-existent wallets.
 *
 * Follows SSR + Live Updates pattern: data is fetched on server and passed
 * to client components as props. No loading spinners for initial content.
 */

import { notFound } from 'next/navigation';
import { cookies } from 'next/headers';
import { getApiUrl } from '../../../../lib/config';
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
 * Fetch profile from backend API during SSR.
 *
 * @param address - TRON wallet address
 * @returns Profile data or null if not found
 */
async function fetchProfile(address: string): Promise<IPublicProfile | null> {
    try {
        const response = await fetch(getApiUrl(`/profile/${address}`), {
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
 * public view based on whether the visitor's cookie UUID matches the
 * profile owner's UUID.
 *
 * Data is passed to client components as props - no client-side fetching
 * for initial page content.
 */
export async function ProfilePage({ address }: ProfilePageProps): Promise<JSX.Element> {
    // Fetch profile data during SSR
    const profile = await fetchProfile(address);

    // Return 404 if profile doesn't exist (no verified wallet)
    if (!profile) {
        notFound();
    }

    // Get visitor's UUID from cookie during SSR
    const cookieStore = await cookies();
    const visitorId = cookieStore.get(USER_ID_COOKIE_NAME)?.value ?? null;

    // Determine if visitor is the profile owner
    const isOwner = visitorId !== null && visitorId === profile.userId;

    // Render appropriate view - data passed as props (SSR pattern)
    if (isOwner) {
        return <ProfileOwnerView profile={profile} />;
    }

    return <ProfilePublicView profile={profile} />;
}
