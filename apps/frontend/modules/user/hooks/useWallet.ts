'use client';

/**
 * TronLink wallet connection hook with two-step linking to User Module.
 *
 * Provides wallet connection functionality via TronLink browser extension.
 * Wallet linking is a two-step process requiring explicit user action:
 *
 * 1. **Connect** - User clicks connect, TronLink prompts for account access,
 *    wallet is stored as unverified in backend.
 * 2. **Verify** - User clicks verify, TronLink prompts for signature,
 *    wallet is marked as verified in backend.
 *
 * @example
 * ```tsx
 * const { connectedAddress, connect, verify, disconnect, isConnected, isVerified } = useWallet();
 *
 * if (!isConnected) {
 *   return <button onClick={connect}>Connect Wallet</button>;
 * }
 *
 * if (!isVerified) {
 *   return <button onClick={verify}>Verify Wallet</button>;
 * }
 *
 * return <button onClick={disconnect}>{connectedAddress}</button>;
 * ```
 */

import { useCallback, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import {
    setConnectedAddress,
    setConnectionStatus,
    setConnectionError,
    setProviderDetected,
    resetWalletConnection,
    setWalletVerified,
    clearWalletLoginRequired,
    connectWalletThunk,
    linkWalletThunk,
    loginThunk,
    logoutThunk,
    selectUserId,
    selectUserInitialized,
    selectWallets,
    selectIsLoggedIn,
    selectWalletLoginRequired,
    selectExistingWalletOwner,
    type WalletConnectionStatus
} from '../slice';
import { getTronWeb, getTronLink } from '../lib';

const DETECTION_INTERVALS = 12;
const DETECTION_DELAY_MS = 500;

/**
 * Hook for TronLink wallet connection with auto-link to User Module.
 */
export function useWallet() {
    const dispatch = useAppDispatch();

    // User state
    const userId = useAppSelector(selectUserId);
    const userInitialized = useAppSelector(selectUserInitialized);

    // Wallet connection state
    const connectedAddress = useAppSelector(state => state.user.connectedAddress);
    const connectionStatus = useAppSelector(state => state.user.connectionStatus);
    const providerDetected = useAppSelector(state => state.user.providerDetected);
    const connectionError = useAppSelector(state => state.user.connectionError);
    const walletVerified = useAppSelector(state => state.user.walletVerified);

    // Linked wallets from backend (for auto-verify check)
    const linkedWallets = useAppSelector(selectWallets);

    // Login state (UI/feature gate)
    const isLoggedIn = useAppSelector(selectIsLoggedIn);

    // Wallet login required state (wallet belongs to another user)
    const walletLoginRequired = useAppSelector(selectWalletLoginRequired);
    const existingWalletOwner = useAppSelector(selectExistingWalletOwner);

    const detectionAttempts = useRef(0);
    const linkAttempted = useRef<string | null>(null);

    /**
     * Detect TronLink provider availability.
     *
     * Only checks if TronLink extension is installed, does NOT read wallet
     * address or establish connection. Address reading happens exclusively
     * in connect() when user clicks the connect button.
     */
    const detectProvider = useCallback(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const tronLink = getTronLink();
        const tronWeb = getTronWeb();
        const detected = Boolean(tronLink) || Boolean(tronWeb);

        if (detected !== providerDetected) {
            dispatch(setProviderDetected(detected));
        }
    }, [dispatch, providerDetected]);

    /**
     * Poll for TronLink provider on mount.
     */
    useEffect(() => {
        if (connectedAddress) {
            return;
        }

        detectionAttempts.current = 0;
        dispatch(setConnectionStatus(providerDetected ? 'checking' : 'idle'));

        const interval = setInterval(() => {
            detectionAttempts.current += 1;
            detectProvider();

            if (connectedAddress || detectionAttempts.current > DETECTION_INTERVALS) {
                clearInterval(interval);
            }
        }, DETECTION_DELAY_MS);

        return () => clearInterval(interval);
    }, [detectProvider, dispatch, connectedAddress, providerDetected]);

    /**
     * Auto-link wallet to User Module when connected (step 1 only).
     *
     * This only stores the wallet as unverified. Verification requires
     * explicit user action via the verify() function.
     */
    useEffect(() => {
        // Only attempt link when:
        // 1. User is initialized (has userId)
        // 2. Wallet is connected
        // 3. We haven't already attempted to link this address
        // 4. Wallet is not already linked (prevents SSR hydration triggering)
        if (!userInitialized || !userId || !connectedAddress) {
            return;
        }

        if (linkAttempted.current === connectedAddress) {
            return;
        }

        // Skip if wallet is already linked (from SSR hydration or previous session)
        const alreadyLinked = linkedWallets.some(w => w.address === connectedAddress);
        if (alreadyLinked) {
            return;
        }

        linkAttempted.current = connectedAddress;

        // Step 1 only: Connect wallet (stores as unverified)
        const connectWallet = async () => {
            try {
                await dispatch(connectWalletThunk({
                    userId,
                    address: connectedAddress
                })).unwrap();
                dispatch(setWalletVerified(false));
                console.log(`Wallet ${connectedAddress} connected to user ${userId} (unverified)`);
            } catch (error) {
                console.warn('Failed to connect wallet:', error);
                dispatch(setWalletVerified(false));
            }
        };

        connectWallet();
    }, [dispatch, userId, userInitialized, connectedAddress, linkedWallets]);

    /**
     * Auto-set verification status based on backend wallet state.
     *
     * If the connected wallet exists in backend, set walletVerified
     * based on the wallet's verified field.
     */
    useEffect(() => {
        if (!connectedAddress) {
            return;
        }

        const linkedWallet = linkedWallets.find(w => w.address === connectedAddress);
        if (linkedWallet) {
            dispatch(setWalletVerified(linkedWallet.verified));
        }
    }, [connectedAddress, linkedWallets, dispatch]);

    /**
     * Set connection status.
     */
    const setStatus = useCallback(
        (status: WalletConnectionStatus) => {
            dispatch(setConnectionStatus(status));
        },
        [dispatch]
    );

    /**
     * Connect to TronLink wallet.
     * Prompts user to approve connection in TronLink extension.
     *
     * Response codes from tron_requestAccounts:
     * - 200: Success (already whitelisted or user approved)
     * - 4000: Request already pending (popup still open)
     * - 4001: User rejected the request
     * - null/undefined: Wallet is locked
     *
     * @see https://docs.tronlink.org/tronlink-wallet-extension/request-tronlink-extension/connect-website
     */
    const connect = useCallback(async () => {
        if (typeof window === 'undefined') {
            return;
        }

        const tronLink = getTronLink();
        const tronWeb = getTronWeb();

        // TronLink not installed at all
        if (!tronLink && !tronWeb) {
            dispatch(setConnectionError(
                'TronLink wallet not detected. Install TronLink or open this page in the TronLink browser.'
            ));
            return;
        }

        try {
            setStatus('connecting');

            // If already ready with an address, use it directly
            if (tronLink?.ready && tronLink.tronWeb?.defaultAddress?.base58) {
                dispatch(setConnectedAddress(tronLink.tronWeb.defaultAddress.base58));
                setStatus('connected');
                return;
            }

            // Request account access via tronLink (preferred) or tronWeb
            const requestFn = tronLink?.request ?? tronWeb?.request;
            if (!requestFn) {
                throw new Error('TronLink request method not available.');
            }

            const response = await requestFn({ method: 'tron_requestAccounts' });

            // Handle response codes per TronLink docs
            if (response?.code === null || response?.code === undefined) {
                throw new Error('TronLink is locked. Please unlock your wallet and try again.');
            }

            if (response.code === 4000) {
                throw new Error('A connection request is already pending. Please check your TronLink popup.');
            }

            if (response.code === 4001) {
                throw new Error('Connection rejected. You declined the connection request.');
            }

            if (response.code !== 200) {
                throw new Error(response.message || 'Unknown error connecting to TronLink.');
            }

            // Success - get the address
            const address = tronLink?.tronWeb?.defaultAddress?.base58 ?? tronWeb?.defaultAddress?.base58;
            if (!address) {
                throw new Error('Connected but wallet address unavailable. Please try again.');
            }

            dispatch(setConnectedAddress(address));
            setStatus('connected');
        } catch (error) {
            setStatus('error');
            const message = error instanceof Error
                ? error.message
                : 'Unable to connect to TronLink wallet.';
            dispatch(setConnectionError(message));
        }
    }, [dispatch, setStatus]);

    /**
     * Disconnect from TronLink wallet.
     * Note: This only clears local state. TronLink remains authorized.
     */
    const disconnect = useCallback(() => {
        linkAttempted.current = null;
        dispatch(resetWalletConnection());
    }, [dispatch]);

    /**
     * Verify wallet ownership via TronLink signature (step 2).
     *
     * Requires wallet to be connected first. Prompts user to sign
     * a message in TronLink to prove wallet ownership.
     *
     * When walletLoginRequired is true, this performs a login (identity swap)
     * instead of linking to current user. The signature proves wallet ownership
     * and the backend will return the existing user's data.
     */
    const verify = useCallback(async () => {
        if (!userId || !connectedAddress) {
            console.warn('Cannot verify: no user or wallet connected');
            return;
        }

        const tronWeb = getTronWeb();
        if (!tronWeb?.trx?.signMessageV2) {
            dispatch(setConnectionError('TronLink signature capability not available.'));
            return;
        }

        try {
            setStatus('connecting');

            const timestamp = Date.now();

            // Use different message format when logging in vs linking
            // For login, we don't include userId in message since we're proving
            // wallet ownership to swap to a different identity
            const message = walletLoginRequired
                ? `Login to TronRelic with wallet ${connectedAddress} at ${timestamp}`
                : `Link wallet ${connectedAddress} to TronRelic identity ${userId} at ${timestamp}`;

            const signature = await tronWeb.trx.signMessageV2(message);

            const result = await dispatch(linkWalletThunk({
                userId,
                address: connectedAddress,
                message,
                signature,
                timestamp
            })).unwrap();

            dispatch(setWalletVerified(true));
            setStatus('connected');

            if (result.identitySwapped) {
                console.log(`Logged in via wallet ${connectedAddress}, identity swapped to ${result.user.id}`);
            } else {
                console.log(`Wallet ${connectedAddress} verified for user ${userId}`);
            }
        } catch (error) {
            setStatus('connected');
            const errorMessage = error instanceof Error
                ? error.message
                : 'Failed to verify wallet.';
            dispatch(setConnectionError(errorMessage));
            console.warn('Wallet verification failed:', error);
        }
    }, [dispatch, userId, connectedAddress, setStatus, walletLoginRequired]);

    /**
     * Sign a message using TronLink.
     * Used for wallet-verified actions.
     */
    const signMessage = useCallback(async (message: string): Promise<string> => {
        if (typeof window === 'undefined') {
            throw new Error('Wallet signing is unavailable in this environment.');
        }

        const tronWeb = getTronWeb();
        if (!tronWeb?.trx?.signMessageV2) {
            throw new Error('TronLink signature capability not available.');
        }

        return tronWeb.trx.signMessageV2(message);
    }, []);

    /**
     * Log in the user (set isLoggedIn to true).
     *
     * This is a UI/feature gate - it controls what is surfaced to the user,
     * not their underlying identity. UUID tracking continues regardless.
     */
    const login = useCallback(async () => {
        if (!userId) {
            console.warn('Cannot login: user not initialized');
            return;
        }

        try {
            await dispatch(loginThunk(userId)).unwrap();
        } catch (error) {
            console.error('Login failed:', error);
            throw error;
        }
    }, [dispatch, userId]);

    /**
     * Log out the user (set isLoggedIn to false).
     *
     * This is a UI/feature gate - wallets and all other data remain intact.
     * Also disconnects from TronLink session.
     */
    const logout = useCallback(async () => {
        if (!userId) {
            console.warn('Cannot logout: user not initialized');
            return;
        }

        try {
            await dispatch(logoutThunk(userId)).unwrap();
            // Also disconnect TronLink session
            linkAttempted.current = null;
            dispatch(resetWalletConnection());
        } catch (error) {
            console.error('Logout failed:', error);
            throw error;
        }
    }, [dispatch, userId]);

    /**
     * Cancel wallet login attempt.
     *
     * Called when user decides not to proceed with wallet-based login.
     * Clears the login required state and disconnects from TronLink.
     */
    const cancelWalletLogin = useCallback(() => {
        dispatch(clearWalletLoginRequired());
        linkAttempted.current = null;
        dispatch(resetWalletConnection());
    }, [dispatch]);

    return {
        // State
        connectedAddress,
        connectionStatus,
        providerDetected,
        connectionError,
        walletVerified,
        isConnected: connectionStatus === 'connected' && connectedAddress !== null,
        isLoggedIn,

        // Wallet login required state
        walletLoginRequired,
        existingWalletOwner,

        // Aliases for backwards compatibility
        address: connectedAddress,
        status: connectionStatus,
        error: connectionError,
        isVerified: walletVerified,

        // Actions
        connect,
        verify,
        disconnect,
        signMessage,
        setStatus,
        login,
        logout,
        cancelWalletLogin
    } as const;
}
