/**
 * User profile page route.
 *
 * Thin wrapper that delegates to ProfilePage component from user module.
 * The profile only exists for verified wallet addresses.
 */

import type { Metadata } from 'next';
import { ProfilePage } from '../../../modules/user/components/Profile/ProfilePage';

/**
 * Page props with dynamic address parameter.
 */
interface ProfilePageProps {
    params: Promise<{
        address: string;
    }>;
}

/**
 * Generate metadata for the profile page.
 */
export async function generateMetadata({ params }: ProfilePageProps): Promise<Metadata> {
    const { address } = await params;
    const shortAddress = `${address.slice(0, 8)}...${address.slice(-6)}`;

    return {
        title: `Profile ${shortAddress}`,
        description: `View profile for TRON wallet ${shortAddress}`
    };
}

/**
 * Profile page route handler.
 *
 * Renders the ProfilePage server component which fetches profile data
 * and determines owner vs public view based on cookie comparison.
 */
export default async function Page({ params }: ProfilePageProps): Promise<JSX.Element> {
    const { address } = await params;
    return <ProfilePage address={address} />;
}
