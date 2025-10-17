'use client';

import { useState, type ReactNode } from 'react';
import { SystemAuthProvider, useSystemAuth, SystemNav } from '../../../features/system';

/**
 * System monitoring layout with authentication.
 *
 * Provides shared authentication state and navigation for all system monitoring pages.
 * Shows a login form when not authenticated, otherwise displays the navigation tabs
 * and page content. All child routes inherit authentication state through context.
 */

/**
 * Login form component for system authentication.
 *
 * Collects admin token and handles login submission. Shown when user is not
 * authenticated. On successful login, stores token in localStorage via the
 * SystemAuth context and shows the authenticated layout.
 */
function LoginForm() {
    const [tokenInput, setTokenInput] = useState('');
    const { login } = useSystemAuth();

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        login(tokenInput);
    };

    return (
        <div className="page" style={{ maxWidth: '400px', margin: '4rem auto', padding: '2rem' }}>
            <div style={{ display: 'grid', gap: '1.5rem' }}>
                <header>
                    <h1>System Monitoring</h1>
                    <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>
                        Enter your admin token to access system monitoring tools
                    </p>
                </header>
                <form onSubmit={handleLogin} style={{ display: 'grid', gap: '1rem' }}>
                    <label style={{ display: 'grid', gap: '0.5rem' }}>
                        <span>Admin Token</span>
                        <input
                            type="password"
                            value={tokenInput}
                            onChange={e => setTokenInput(e.target.value)}
                            placeholder="Enter admin API token"
                            style={{ padding: '0.75rem', fontSize: '1rem' }}
                            required
                        />
                    </label>
                    <button type="submit" style={{ padding: '0.75rem', fontSize: '1rem' }}>
                        Access System Monitor
                    </button>
                </form>
            </div>
        </div>
    );
}

/**
 * Authenticated layout with navigation and logout.
 *
 * Shows the system navigation tabs and wraps child page content. Provides logout
 * button in header. Only rendered when user is authenticated.
 *
 * @param props - Component props
 * @param props.children - Page content to render below navigation
 */
function AuthenticatedLayout({ children }: { children: ReactNode }) {
    const { logout } = useSystemAuth();

    return (
        <div className="page" style={{ padding: '2rem' }}>
            <div style={{ display: 'grid', gap: '2rem' }}>
                <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                        <h1>System Monitoring Dashboard</h1>
                        <p style={{ opacity: 0.7, marginTop: '0.5rem' }}>
                            Real-time visibility into blockchain sync, jobs, markets, and system health
                        </p>
                    </div>
                    <button onClick={logout} style={{ padding: '0.5rem 1rem' }}>
                        Logout
                    </button>
                </header>

                <SystemNav />

                <section>
                    {children}
                </section>
            </div>
        </div>
    );
}

/**
 * Layout content that checks authentication state.
 *
 * Renders either the login form or authenticated layout based on current auth state.
 * This component must be inside SystemAuthProvider to access the context.
 *
 * @param props - Component props
 * @param props.children - Page content passed from route segments
 */
function LayoutContent({ children }: { children: ReactNode }) {
    const { isAuthenticated } = useSystemAuth();

    if (!isAuthenticated) {
        return <LoginForm />;
    }

    return <AuthenticatedLayout>{children}</AuthenticatedLayout>;
}

/**
 * Root system layout component.
 *
 * Wraps all /system routes with authentication provider and layout. Provides shared
 * navigation and authentication state to all system monitoring pages. All child routes
 * automatically inherit this layout.
 *
 * @param props - Component props
 * @param props.children - Page content from Next.js route segments
 */
export default function SystemLayout({ children }: { children: ReactNode }) {
    return (
        <SystemAuthProvider>
            <LayoutContent>{children}</LayoutContent>
        </SystemAuthProvider>
    );
}
