/**
 * @fileoverview Route layout that gates `/profile` to the signed-in account.
 *
 * Wrapping the route here (rather than in each page) means every current and
 * future profile sub-surface inherits the login gate automatically. The gate
 * is a client component fed the SSR-rendered children, so signed-out visitors
 * see a sign-in prompt while the protected markup is withheld.
 */

import type { ReactNode } from 'react';
import { ProfileAuthGate } from '../../../modules/user/components/ProfileAuthGate';

/**
 * Profile route layout.
 *
 * @param props.children - The profile page tree to protect.
 * @returns The children wrapped in the login gate.
 */
export default function ProfileLayout({ children }: { children: ReactNode }) {
    return <ProfileAuthGate>{children}</ProfileAuthGate>;
}
