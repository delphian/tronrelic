'use client';

import { useMemo, type ReactNode } from 'react';
import { Provider } from 'react-redux';
import { createStore } from '../store';
import { SocketBridge } from '../components/socket/SocketBridge';
import { CoreToastHandler } from '../components/socket/CoreToastHandler';
import { NotificationHandler } from '../components/socket/NotificationHandler';
import { ToastProvider, ToastViewport } from '../components/ui/ToastProvider';
import { ModalProvider, ModalViewport } from '../components/ui/ModalProvider';
import { PluginLoader } from '../components/plugins/PluginLoader';
import { FrontendPluginContextProvider } from '../lib/frontendPluginContext';
// Direct imports avoid pulling component CSS via barrel exports
import { SessionProvider } from '../modules/user/components/SessionProvider';
import { PageViewTracker } from '../modules/user/components/PageViewTracker';
import { MenuSeedProvider } from '../modules/menu/components/MenuSeedProvider';
import type { IMenuSeed } from '../modules/menu/types';
import type { ISSRSession } from '../modules/user/lib/session-server';

// Re-export the SSR session shape for layout.tsx
export type { ISSRSession };

/** Seeds used when the layout passes none; module-level so its identity is stable. */
const EMPTY_MENU_SEEDS: Record<string, IMenuSeed> = {};

interface ProvidersProps {
    children: ReactNode;
    /**
     * Better Auth session resolved during SSR. Seeds the SessionProvider so
     * logged-in visitors don't flash signed-out on first paint. Better Auth
     * is the sole identity layer — the legacy UUID Redux preload was removed
     * in the Phase 6 cutover.
     */
    ssrSession?: ISSRSession | null;
    /**
     * Menu trees the root layout fetched for this visitor, keyed by
     * namespace. The main menu is a widget, and widget data is shared by
     * every visitor, so its per-visitor tree reaches the widget through
     * `MenuSeedProvider` instead of the widget payload.
     */
    ssrMenus?: Record<string, IMenuSeed>;
}

/**
 * Compose every provider the application needs, in the order each depends
 * on the ones outside it.
 *
 * @param props - The page subtree plus the session and menu trees resolved during SSR.
 * @returns The subtree wrapped in every provider.
 */
export function Providers({ children, ssrSession, ssrMenus }: ProvidersProps) {
    // Memoize the store so it survives re-renders. No SSR slice is preloaded
    // — identity is seeded into the SessionProvider via React context, not
    // Redux.
    const store = useMemo(() => createStore(), []);

    return (
        <Provider store={store}>
            {/* A toast body and a modal body are drawn through a React portal,
                and a portal renders from the tree position of the component
                that created it rather than from the DOM node it targets. That
                is why the toast and modal markup is not emitted by the
                providers themselves: the two viewport components below sit at
                the bottom of the stack, so a toast or a dialog can reach every
                provider here. Before that split, a toast rendering
                `TronAddress` — which the whale alert does — threw, because
                `TronAddress` calls `useModal` and the toast markup came out
                above `ModalProvider`.

                Both viewports must stay inside every provider a toast or modal
                body may use. Moving either one higher brings that failure back
                for whichever context it is lifted above. */}
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
                            <MenuSeedProvider seeds={ssrMenus ?? EMPTY_MENU_SEEDS}>
                                {children}
                            </MenuSeedProvider>
                            <ToastViewport />
                            <ModalViewport />
                        </FrontendPluginContextProvider>
                    </ModalProvider>
                </ToastProvider>
            </SessionProvider>
        </Provider>
    );
}
