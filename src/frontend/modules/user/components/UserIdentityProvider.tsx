'use client';

/**
 * User identity provider component.
 *
 * Initializes user identity on app mount by:
 * 1. Getting or creating UUID from cookie/localStorage
 * 2. Fetching or creating user record from backend
 * 3. Starting session tracking (captures country, device, referrer)
 *
 * Must be rendered inside Redux Provider and after SocketBridge.
 */

import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../../store';
import {
    initializeUser,
    selectUserInitialized,
    selectUserId
} from '../slice';
import { useSessionTracking } from '../hooks';

/**
 * Props for UserIdentityProvider.
 */
export interface UserIdentityProviderProps {
    /**
     * Child components to render.
     */
    children: React.ReactNode;
}

/**
 * Provider component that initializes user identity.
 *
 * This component:
 * - Gets or creates a user UUID on mount
 * - Fetches/creates user record from backend
 * - Records user activity
 * - Does NOT render anything additional to the page
 *
 * @example
 * ```tsx
 * // In providers.tsx
 * <Provider store={store}>
 *   <ToastProvider>
 *     <ModalProvider>
 *       <FrontendPluginContextProvider>
 *         <SocketBridge />
 *         <UserIdentityProvider>
 *           <PluginLoader />
 *           {children}
 *         </UserIdentityProvider>
 *       </FrontendPluginContextProvider>
 *     </ModalProvider>
 *   </ToastProvider>
 * </Provider>
 * ```
 */
export function UserIdentityProvider({
    children
}: UserIdentityProviderProps) {
    const dispatch = useDispatch<AppDispatch>();
    const initialized = useSelector(selectUserInitialized);
    const userId = useSelector(selectUserId);
    const initAttempted = useRef(false);

    useEffect(() => {
        // Skip if already initialized (SSR preloaded state) or in-flight.
        if (initialized || initAttempted.current) {
            return;
        }

        initAttempted.current = true;

        // The server owns identity. Bootstrap minted the cookie if absent
        // and returns the canonical user; the response Set-Cookie keeps
        // subsequent requests anchored to the right id without any
        // client-side UUID handling.
        dispatch(initializeUser())
            .catch(() => {
                // Error handling is done in the slice
            });
    }, [dispatch, initialized]);

    // Session tracking handles page visits, heartbeats, and country/device capture
    // Only enabled after user is initialized to ensure we have a valid userId
    useSessionTracking({
        userId: initialized ? userId : null,
        enabled: initialized && !!userId
    });

    return <>{children}</>;
}
