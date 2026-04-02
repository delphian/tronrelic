/**
 * User profile page route.
 *
 * Thin wrapper that delegates to ProfilePage component from user module.
 * The profile only exists for verified wallet addresses.
 * Includes widget zones so plugins can inject UI into profile pages.
 */

import type { Metadata } from 'next';
import { ProfilePage } from '../../../modules/user/components/Profile/ProfilePage';
import { WidgetZone, fetchWidgetsForRoute } from '../../../components/widgets';

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
 * Fetches widgets for this route and renders a main-after zone below
 * the profile content, enabling plugins to inject UI into profile pages.
 */
export default async function Page({ params }: ProfilePageProps): Promise<JSX.Element> {
    const { address } = await params;
    const route = `/u/${address}`;
    const routeParams = { address };
    const widgets = await fetchWidgetsForRoute(route, routeParams);

    return (
        <>
            <ProfilePage address={address} />
            <WidgetZone name="main-after" widgets={widgets} route={route} params={routeParams} />
        </>
    );
}
