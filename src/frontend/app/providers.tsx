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
            <ToastProvider>
                <ModalProvider>
                    <FrontendPluginContextProvider>
                        <SocketBridge />
                        <CoreToastHandler />
                        {/* Per-user notification toasts (identity-room targeted),
                            sibling to the global CoreToastHandler. Mounted before
                            the session provider so the listener is always live. */}
                        <NotificationHandler />
                        <SessionProvider initialSession={ssrSession ?? null}>
                            <PluginLoader />
                            <PageViewTracker />
                            {children}
                        </SessionProvider>
                    </FrontendPluginContextProvider>
                </ModalProvider>
            </ToastProvider>
        </Provider>
    );
}
