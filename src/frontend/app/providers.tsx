'use client';

import { useMemo, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { createStore } from '../store';
import { SocketBridge } from '../components/socket/SocketBridge';
import { CoreToastHandler } from '../components/socket/CoreToastHandler';
import { NotificationHandler } from '../components/socket/NotificationHandler';
import { ToastProvider } from '../components/ui/ToastProvider';
import { ModalProvider } from '../components/ui/ModalProvider';
import { PluginLoader } from '../components/plugins/PluginLoader';
import { FrontendPluginContextProvider } from '../lib/frontendPluginContext';
// Direct imports avoid pulling component CSS via barrel exports
import { SessionProvider } from '../modules/user/components/SessionProvider';
import { PageViewTracker } from '../modules/user/components/PageViewTracker';
import type { ISSRSession } from '../modules/user/lib/session-server';

// Re-export the SSR session shape for layout.tsx
export type { ISSRSession };

interface ProvidersProps {
    children: ReactNode;
    /**
     * Better Auth session resolved during SSR. Seeds the SessionProvider so
     * logged-in visitors don't flash signed-out on first paint. Better Auth
     * is the sole identity layer — the legacy UUID Redux preload was removed
     * in the Phase 6 cutover.
     */
    ssrSession?: ISSRSession | null;
}

export function Providers({ children, ssrSession }: ProvidersProps) {
    // Memoize the store so it survives re-renders. No SSR slice is preloaded
    // — identity is seeded into the SessionProvider via React context, not
    // Redux.
    const store = useMemo(() => createStore(), []);

    return (
        <Provider store={store}>
            {/* The session provider sits above the toast and modal providers
                because both render their content through a React portal from
                their own position in the tree. A toast or modal body is
                therefore a child of the provider that owns it, not of the page
                that opened it, so anything inside one that calls
                `useAuthSession` — `TronAddress`, for example, which the whale
                toast renders — only finds the context when the session
                provider is an ancestor of the toast provider itself. */}
            <SessionProvider initialSession={ssrSession ?? null}>
                <ToastProvider>
                    <ModalProvider>
                        <FrontendPluginContextProvider>
                            <SocketBridge />
                            <CoreToastHandler />
                            {/* Per-user notification toasts (identity-room targeted),
                                sibling to the global CoreToastHandler. */}
                            <NotificationHandler />
                            <PluginLoader />
                            <PageViewTracker />
                            {children}
                        </FrontendPluginContextProvider>
                    </ModalProvider>
                </ToastProvider>
            </SessionProvider>
        </Provider>
    );
}
