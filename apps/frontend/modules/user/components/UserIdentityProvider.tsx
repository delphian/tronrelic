'use client';

/**
 * User identity provider component.
 *
 * Initializes user identity on app mount by:
 * 1. Getting or creating UUID from cookie/localStorage
 * 2. Fetching or creating user record from backend
 * 3. Recording activity
 *
 * Must be rendered inside Redux Provider and after SocketBridge.
 */

import { useEffect, useRef } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import type { AppDispatch } from '../../../store';
import {
    initializeUser,
    recordActivityThunk,
    selectUserInitialized,
    selectUserId
} from '../slice';
import { getOrCreateUserId } from '../lib';

/**
 * Props for UserIdentityProvider.
 */
export interface UserIdentityProviderProps {
    /**
     * Child components to render.
     */
    children: React.ReactNode;

    /**
     * Optional initial cookie string for SSR hydration.
     * If provided, will be used to check for existing user ID.
     */
    initialCookies?: string;
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
    children,
    initialCookies
}: UserIdentityProviderProps) {
    const dispatch = useDispatch<AppDispatch>();
    const initialized = useSelector(selectUserInitialized);
    const userId = useSelector(selectUserId);
    const initAttempted = useRef(false);

    useEffect(() => {
        // Skip if already initialized or initialization was attempted
        if (initialized || initAttempted.current) {
            return;
        }

        initAttempted.current = true;

        // Get or create user ID
        const id = getOrCreateUserId(initialCookies);

        // Initialize user in backend
        dispatch(initializeUser(id))
            .then((result) => {
                // Record activity after successful initialization
                if (result.meta.requestStatus === 'fulfilled') {
                    dispatch(recordActivityThunk(id));
                }
            })
            .catch(() => {
                // Error handling is done in the slice
            });
    }, [dispatch, initialized, initialCookies]);

    // Record activity on subsequent page views (when user is already initialized)
    useEffect(() => {
        if (initialized && userId) {
            dispatch(recordActivityThunk(userId));
        }
    }, [dispatch, initialized, userId]);

    return <>{children}</>;
}
