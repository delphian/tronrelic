'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

/**
 * Authentication context for system monitoring pages.
 *
 * Provides shared authentication state across all /system routes. Manages admin token
 * storage in localStorage and exposes login/logout methods. All system pages should
 * consume this context to access the authenticated token.
 */

interface ISystemAuthContext {
    /** The admin API token, or empty string if not authenticated */
    token: string;
    /** Whether the user is currently authenticated */
    isAuthenticated: boolean;
    /** Login with an admin token */
    login: (token: string) => void;
    /** Logout and clear stored token */
    logout: () => void;
}

const SystemAuthContext = createContext<ISystemAuthContext | undefined>(undefined);

/**
 * Provider component for system authentication context.
 *
 * Wraps the system monitoring section and manages authentication state. Automatically
 * loads saved tokens from localStorage on mount. Should be placed in the system
 * layout.tsx to cover all system routes.
 *
 * @param props - Component props
 * @param props.children - Child components that can access the auth context
 */
export function SystemAuthProvider({ children }: { children: ReactNode }) {
    const [token, setToken] = useState('');
    const [isAuthenticated, setIsAuthenticated] = useState(false);

    useEffect(() => {
        const savedToken = localStorage.getItem('admin_token');
        if (savedToken) {
            setToken(savedToken);
            setIsAuthenticated(true);
        }
    }, []);

    const login = (newToken: string) => {
        if (newToken.trim()) {
            localStorage.setItem('admin_token', newToken);
            setToken(newToken);
            setIsAuthenticated(true);
        }
    };

    const logout = () => {
        localStorage.removeItem('admin_token');
        setToken('');
        setIsAuthenticated(false);
    };

    return (
        <SystemAuthContext.Provider value={{ token, isAuthenticated, login, logout }}>
            {children}
        </SystemAuthContext.Provider>
    );
}

/**
 * Hook to access system authentication context.
 *
 * Provides access to the admin token and authentication methods. Must be used within
 * a SystemAuthProvider. Throws an error if used outside the provider.
 *
 * @returns The authentication context with token, auth state, and login/logout methods
 * @throws Error if used outside SystemAuthProvider
 */
export function useSystemAuth(): ISystemAuthContext {
    const context = useContext(SystemAuthContext);
    if (!context) {
        throw new Error('useSystemAuth must be used within SystemAuthProvider');
    }
    return context;
}
