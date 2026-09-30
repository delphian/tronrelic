/**
 * @fileoverview `/oauth/authorize` — the page Better Auth sends a user to when
 * a connected app (such as an MCP client) asks to act on their account.
 *
 * Serves as both the OAuth login page and the consent page. On the server it
 * resolves the session and, for a signed-in visitor, the requesting app's
 * details, so the consent card renders with real content and no loading flash.
 * The client component handles sign-in and the Allow/Deny decision.
 */

import { headers } from 'next/headers';
import type { Metadata } from 'next';
import type { IOAuthConsentContext } from '@/types';
import { getServerSideApiUrlWithPath } from '../../../../lib/api-url';
import { getServerSession } from '../../../../modules/user/lib/session-server';
import { Page, PageHeader } from '../../../../components/layout';
import { OAuthConsent } from '../../../../modules/user';

export const metadata: Metadata = {
    title: 'Connect an app',
    robots: { index: false, follow: false }
};

/** Query parameters of the signed authorization request the page is opened with. */
interface IAuthorizeSearchParams {
    client_id?: string | string[];
    redirect_uri?: string | string[];
    scope?: string | string[];
}

/**
 * Collapse a query value Next.js may deliver as an array to its first entry.
 *
 * @param value - The raw query value.
 * @returns The first value, or an empty string.
 */
function first(value: string | string[] | undefined): string {
    return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

/**
 * Fetch the consent context for the requesting app, forwarding the session
 * cookie. Any failure yields null, which the page shows as "could not be
 * identified" with a way to cancel.
 *
 * @param params - The authorization request's client id, redirect URI, and scope.
 * @returns The consent context, or null.
 */
async function fetchConsentContext(params: { clientId: string; redirectUri: string; scope: string }): Promise<IOAuthConsentContext | null> {
    let context: IOAuthConsentContext | null = null;
    try {
        const cookie = (await headers()).get('cookie');
        if (cookie && params.clientId && params.redirectUri) {
            const query = new URLSearchParams({ client_id: params.clientId, redirect_uri: params.redirectUri, scope: params.scope });
            const response = await fetch(`${getServerSideApiUrlWithPath()}/user/oauth/authorize-context?${query.toString()}`, {
                headers: { Cookie: cookie },
                cache: 'no-store'
            });
            if (response.ok) {
                const data = await response.json() as { context?: IOAuthConsentContext };
                context = data.context ?? null;
            }
        }
    } catch {
        context = null;
    }
    return context;
}

/**
 * Authorize page server component.
 *
 * @param props - Next.js route props.
 * @param props.searchParams - The signed authorization query (a Promise in Next.js 15+).
 * @returns The page with the sign-in or consent card.
 */
export default async function OAuthAuthorizePage({
    searchParams
}: {
    searchParams: Promise<IAuthorizeSearchParams>;
}) {
    const params = await searchParams;
    const session = await getServerSession();
    const context = session
        ? await fetchConsentContext({
            clientId: first(params.client_id),
            redirectUri: first(params.redirect_uri),
            scope: first(params.scope)
        })
        : null;

    return (
        <Page>
            <PageHeader title="Connect an app" subtitle="Review what this app is asking for before you allow it." />
            <OAuthConsent context={context} signedInOnServer={session !== null} />
        </Page>
    );
}
