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
import { buildSSRUserState, type SSRUserData } from '../modules/user/lib';

// Re-export SSRUserData for layout.tsx to use
export type { SSRUserData };

interface ProvidersProps {
    children: ReactNode;
    /**
     * User data fetched during SSR for hydration.
     * If provided, initializes Redux with user state to prevent flash.
     */
    ssrUserData?: SSRUserData | null;
}

export function Providers({ children, ssrUserData }: ProvidersProps) {
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
                            <PluginLoader />
                            {children}
                        </UserIdentityProvider>
                    </FrontendPluginContextProvider>
                </ModalProvider>
            </ToastProvider>
        </Provider>
    );
}
