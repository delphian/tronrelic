'use client';

import { useState, type ReactNode } from 'react';
import { SystemAuthProvider, useSystemAuth, SystemNav } from '../../../features/system';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import styles from './layout.module.css';

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
 * SystemAuth context and shows the authenticated layout. Includes error handling
 * and accessibility attributes for screen readers.
 */
function LoginForm() {
    const [tokenInput, setTokenInput] = useState('');
    const [error, setError] = useState('');
    const { login } = useSystemAuth();

    const handleLogin = (e: React.FormEvent) => {
        e.preventDefault();
        setError('');

        if (!tokenInput.trim()) {
            setError('Admin token is required');
            return;
        }

        login(tokenInput);
    };

    return (
        <div className={`page ${styles.login_container}`}>
            <div className={styles.login_content}>
                <header className={styles.login_header}>
                    <h1 className={styles.login_title}>System Monitoring</h1>
                    <p className={styles.login_subtitle}>
                        Enter your admin token to access system monitoring tools
                    </p>
                </header>
                <form onSubmit={handleLogin} className={styles.login_form} aria-label="Admin authentication form">
                    <label className={styles.login_label} htmlFor="admin-token">
                        <span className={styles.login_label_text}>Admin Token</span>
                        <Input
                            id="admin-token"
                            type="password"
                            value={tokenInput}
                            onChange={e => setTokenInput(e.target.value)}
                            placeholder="Enter admin API token"
                            required
                            aria-required="true"
                            aria-invalid={!!error}
                            aria-describedby={error ? 'login-error' : undefined}
                        />
                    </label>
                    {error && (
                        <div id="login-error" className={styles.error_message} role="alert">
                            {error}
                        </div>
                    )}
                    <Button type="submit" variant="primary" size="lg">
                        Access System Monitor
                    </Button>
                </form>
            </div>
        </div>
    );
}

/**
 * Authenticated layout with navigation and logout.
 *
 * Shows the system navigation tabs and wraps child page content. Provides logout
 * button in header. Only rendered when user is authenticated. Uses design system
 * Button component for consistent styling.
 *
 * @param props - Component props
 * @param props.children - Page content to render below navigation
 */
function AuthenticatedLayout({ children }: { children: ReactNode }) {
    const { logout } = useSystemAuth();

    return (
        <div className={`page ${styles.layout_container}`}>
            <div className={styles.layout_content}>
                <header className={styles.layout_header}>
                    <div className={styles.layout_header_text}>
                        <h1 className={styles.layout_title}>System Monitoring Dashboard</h1>
                        <p className={styles.layout_subtitle}>
                            Real-time visibility into blockchain sync, jobs, markets, and system health
                        </p>
                    </div>
                    <Button onClick={logout} variant="secondary" size="md" aria-label="Logout from system monitoring">
                        Logout
                    </Button>
                </header>

                <SystemNav />

                <section className={styles.layout_section}>
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
