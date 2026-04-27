'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSystemAuth } from '../../../../features/system';

/**
 * Admin logout route.
 *
 * Replaces the previous trailing-nav-item logout pattern. The Logout
 * entry in the main navigation now points here as a normal menu link;
 * this page clears the admin token via the SystemAuth context and
 * redirects home so the visitor lands on a non-admin surface.
 *
 * The whole `/system/*` subtree is wrapped by `SystemAuthGate`, so a
 * logged-out visitor reaching this URL directly sees the login form
 * instead of executing the logout side-effect — which is the right
 * behavior: there is nothing to log out of.
 */
export default function SystemLogoutPage() {
    const { logout } = useSystemAuth();
    const router = useRouter();

    useEffect(() => {
        logout();
        router.replace('/');
    }, [logout, router]);

    return null;
}
