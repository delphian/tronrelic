'use client';

import { useMemo, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { createStore } from '../store';
import { SocketBridge } from '../components/socket/SocketBridge';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ModalProvider } from '../components/ui/ModalProvider';
import { PluginLoader } from '../components/plugins/PluginLoader';
import { FrontendPluginContextProvider } from '../lib/frontendPluginContext';
// Direct imports avoid pulling component CSS via barrel exports
import { UserIdentityProvider } from '../modules/user/components/UserIdentityProvider';
import { SessionProvider } from '../modules/user/components/SessionProvider';
import { buildSSRUserState, type SSRUserData } from '../modules/user/lib';
import type { ISSRSession } from '../modules/user/lib/session-server';

// Re-export SSR data shapes for layout.tsx
export type { SSRUserData };
export type { ISSRSession };

interface ProvidersProps {
    children: ReactNode;
    /**
     * Legacy user data fetched during SSR for the UUID-based identity
     * system. Initializes Redux with user state to prevent flash.
     */
    ssrUserData?: SSRUserData | null;
    /**
     * Better Auth session resolved during SSR. Seeds the SessionProvider
     * so logged-in visitors don't flash signed-out on first paint.
     * Phase 3 wiring — coexists with `ssrUserData` until Phase 6
     * retires the legacy surface.
     */
    ssrSession?: ISSRSession | null;
}

export function Providers({ children, ssrUserData, ssrSession }: ProvidersProps) {
    // Create store with preloaded state (memoized to prevent recreation)
    const store = useMemo(() => {
        const preloadedState = ssrUserData
            ? { user: buildSSRUserState(ssrUserData) }
            : undefined;
        return createStore(preloadedState);
    }, [ssrUserData]);

    return (
        <Provider store={store}>
            <ToastProvider>
                <ModalProvider>
                    <FrontendPluginContextProvider>
                        <SocketBridge />
                        <UserIdentityProvider>
                            <SessionProvider initialSession={ssrSession ?? null}>
                                <PluginLoader />
                                {children}
                            </SessionProvider>
                        </UserIdentityProvider>
                    </FrontendPluginContextProvider>
                </ModalProvider>
            </ToastProvider>
        </Provider>
    );
}
