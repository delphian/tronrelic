/**
 * Authentication gate component for system monitoring pages.
 *
 * This client component handles the authentication UI logic including login form
 * display and authenticated layout rendering. It consumes the SystemAuth context
 * to determine whether to show the login form or render the authenticated content.
 *
 * The component is designed to be wrapped by SystemAuthProvider in the server layout,
 * allowing the layout itself to remain a server component while authentication state
 * management happens on the client.
 *
 * @example
 * ```tsx
 * // In server layout
 * <SystemAuthProvider>
 *   <SystemAuthGate>
 *     {children}
 *   </SystemAuthGate>
 * </SystemAuthProvider>
 * ```
 */
'use client';

import { useState, type ReactNode } from 'react';
import { useSystemAuth } from '../../contexts/SystemAuthContext';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import styles from '../../../../app/(dashboard)/system/layout.module.css';

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
        <div className={styles.login_container}>
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
 * Authenticated layout with logout functionality.
 *
 * Shows the logout button in header, navigation below header, and wraps child page content.
 * Only rendered when user is authenticated. Uses design system Button component for consistent
 * styling.
 *
 * @param props - Component props
 * @param props.navigation - Navigation component to render below header
 * @param props.children - Page content to render
 */
function AuthenticatedLayout({ navigation, children }: { navigation?: ReactNode; children: ReactNode }) {
    const { logout } = useSystemAuth();

    return (
        <div className={styles.layout_container}>
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

                {navigation}

                <section className={styles.layout_section}>
                    {children}
                </section>
            </div>
        </div>
    );
}

/**
 * Authentication gate component that checks auth state.
 *
 * Renders either the login form or authenticated layout based on current auth state.
 * This component must be inside SystemAuthProvider to access the context.
 *
 * The navigation is passed from the parent server layout and rendered inside the
 * authenticated layout below the header, ensuring proper visual hierarchy.
 *
 * @param props - Component props
 * @param props.navigation - Navigation component to render below header (server-side rendered)
 * @param props.children - Page content passed from route segments
 */
export function SystemAuthGate({ navigation, children }: { navigation?: ReactNode; children: ReactNode }) {
    const { isAuthenticated } = useSystemAuth();

    if (!isAuthenticated) {
        return <LoginForm />;
    }

    return <AuthenticatedLayout navigation={navigation}>{children}</AuthenticatedLayout>;
}
