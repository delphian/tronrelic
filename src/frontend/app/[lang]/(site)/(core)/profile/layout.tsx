/**
 * @fileoverview Route layout that gates `/profile` to the signed-in account.
 *
 * Wrapping the route here (rather than in each page) means every current and
 * future profile sub-surface inherits the login gate automatically. The gate
 * is a client component fed the SSR-rendered children, so signed-out visitors
 * see a sign-in prompt while the protected markup is withheld. The same
 * layout keeps every profile route out of search results.
 */

import type { ReactNode } from 'react';
import type { Metadata } from 'next';
import { ProfileAuthGate } from '../../../../../modules/user/components/ProfileAuthGate';

/**
 * Keep every `/profile` route out of search results.
 *
 * A crawler is never signed in, so all it can index here is the sign-in
 * prompt. Next.js replaces the robots field rather than merging it, so this
 * overrides the root layout's `index, follow` for the whole route.
 */
export const metadata: Metadata = {
    robots: {
        index: false,
        follow: false
    }
};

/**
 * Profile route layout.
 *
 * @param props.children - The profile page tree to protect.
 * @returns The children wrapped in the login gate.
 */
export default function ProfileLayout({ children }: { children: ReactNode }) {
    return <ProfileAuthGate>{children}</ProfileAuthGate>;
}
