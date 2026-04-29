'use client';

/**
 * TronLink wallet connection hook driving the two-stage wallet flow.
 *
 * Provides wallet connection functionality via the TronLink browser extension.
 * Wallets are added in two stages mapping to the canonical user states (see
 * the User Module README for the anonymous / registered / verified taxonomy):
 *
 * 1. **Register** — User clicks connect, TronLink prompts for account access,
 *    wallet is stored on the backend with `verified: false`. The user
 *    transitions from *anonymous* to *registered*.
 * 2. **Verify** — User clicks verify, TronLink prompts for signature,
 *    wallet is upgraded to `verified: true`. The user becomes *verified*.
 *
 * The exposed `connect` and `verify` actions perform stages 1 and 2
 * respectively. `isVerified` reflects the verified state of the currently
 * connected wallet (true ⇒ user is at least *verified* via this wallet).
 *
 * @example
 * ```tsx
 * const { connectedAddress, connect, verify, disconnect, isConnected, isVerified } = useWallet();
 *
 * if (!isConnected) {
 *   return <button onClick={connect}>Connect Wallet</button>;  // registers
 * }
 *
 * if (!isVerified) {
 *   return <button onClick={verify}>Verify Wallet</button>;     // verifies
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
    refreshWalletVerificationThunk,
    logoutThunk,
    selectUserId,
    selectUserInitialized,
    selectWallets,
    selectHasWallets,
    selectIsVerified,
    selectWalletLoginRequired,
    selectExistingWalletOwner,
    type WalletConnectionStatus
} from '../slice';
import { requestWalletChallenge } from '../api';
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

    // User-level identity. The backend ships `identityState` already
    // resolved through the lazy session-expiry pass, so a stale-collapsed
    // user reads as Registered (not Verified) here. WalletButton consults
    // this rather than the per-wallet `walletVerified` historical flag to
    // decide whether to send the user to the Verified-only profile route
    // or show the verify CTA.
    const isUserVerified = useAppSelector(selectIsVerified);

    // Linked wallets from backend (for auto-verify check)
    const linkedWallets = useAppSelector(selectWallets);

    // Has at least one linked wallet — proxy for "this visitor has done
    // anything past Anonymous". Drives WalletButton's branching alongside
    // `isUserVerified`. Replaces the legacy `isLoggedIn` UI flag, which
    // was a separate boolean independent of identity state; now we read
    // identity state directly.
    const hasWallets = useAppSelector(selectHasWallets);

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
     * Auto-register wallet to the User Module when connected (stage 1 only).
     *
     * Stores the wallet on the backend with `verified: false`, which is what
     * moves the user into the *registered* state. Upgrading to *verified*
     * requires explicit user action via the `verify()` function.
     */
    useEffect(() => {
        // Only attempt registration when:
        // 1. User is initialized (has userId)
        // 2. Wallet is connected in TronLink
        // 3. We haven't already attempted this address
        // 4. Wallet is not already linked (prevents SSR hydration retriggering)
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

        // Stage 1 only: register the wallet (stored with verified=false)
        const registerWallet = async () => {
            try {
                await dispatch(connectWalletThunk({
                    userId,
                    address: connectedAddress
                })).unwrap();
                dispatch(setWalletVerified(false));
                console.log(`Wallet ${connectedAddress} registered to user ${userId} (verified=false)`);
            } catch (error) {
                console.warn('Failed to register wallet:', error);
                dispatch(setWalletVerified(false));
            }
        };

        registerWallet();
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
     * Verify wallet ownership via TronLink signature (stage 2).
     *
     * Requires the wallet to be connected (registered) first. Prompts the user
     * to sign a message in TronLink, which moves the user into the *verified*
     * state on the backend.
     *
     * When `walletLoginRequired` is true, this performs a login (identity
     * swap) instead of attaching the wallet to the current UUID. The signature
     * proves wallet ownership and the backend returns the existing
     * (already-verified) user's data, which the frontend then adopts.
     */
    const verify = useCallback(async (): Promise<boolean> => {
        if (!userId || !connectedAddress) {
            console.warn('Cannot verify: no user or wallet connected');
            return false;
        }

        const tronWeb = getTronWeb();
        if (!tronWeb?.trx?.signMessageV2) {
            dispatch(setConnectionError('TronLink signature capability not available.'));
            return false;
        }

        try {
            setStatus('connecting');

            // Server mints a single-use nonce bound to (userId, 'link', address)
            // and returns the canonical message we must sign verbatim.
            const challenge = await requestWalletChallenge(userId, 'link', connectedAddress);

            const signature = await tronWeb.trx.signMessageV2(challenge.message);

            const result = await dispatch(linkWalletThunk({
                userId,
                address: connectedAddress,
                message: challenge.message,
                signature,
                nonce: challenge.nonce
            })).unwrap();

            dispatch(setWalletVerified(true));
            setStatus('connected');

            if (result.identitySwapped) {
                console.log(`Logged in via wallet ${connectedAddress}, identity swapped to ${result.user.id}`);
            } else {
                console.log(`Wallet ${connectedAddress} verified for user ${userId}`);
            }

            return true;
        } catch (error) {
            setStatus('connected');
            const errorMessage = error instanceof Error
                ? error.message
                : 'Failed to verify wallet.';
            dispatch(setConnectionError(errorMessage));
            console.warn('Wallet verification failed:', error);
            return false;
        }
    }, [dispatch, userId, connectedAddress, setStatus, walletLoginRequired]);

    /**
     * Refresh `verifiedAt` on an already-verified wallet via a fresh
     * TronLink signature.
     *
     * Mints a `'refresh-verification'` challenge, prompts TronLink to
     * sign the canonical message, and dispatches the thunk that
     * consumes the nonce on the backend. On success the user document
     * is refetched, `identityState` re-derives as `Verified`, and any
     * gates that depend on it (admin nav, public profile, plugin
     * features) come back online.
     *
     * Narrower equivalent of `verify()`, which uses the link flow.
     * Both produce an identical `verifiedAt` update on a wallet the
     * user already owns; the WalletButton uses `verify()` because it's
     * already wired and link's full validation is harmless. This hook
     * exposes the dedicated path for callers that want to skip link's
     * identity-swap detection.
     *
     * `address` defaults to `connectedAddress` because the caller
     * usually wants to refresh whichever wallet TronLink currently has
     * active. Pass an explicit address when the UI lets the user choose
     * among multiple verified wallets.
     */
    const refreshVerification = useCallback(async (address?: string): Promise<boolean> => {
        const target = address ?? connectedAddress;
        if (!userId || !target) {
            console.warn('Cannot refresh verification: no user or wallet address');
            return false;
        }

        const tronWeb = getTronWeb();
        if (!tronWeb?.trx?.signMessageV2) {
            dispatch(setConnectionError('TronLink signature capability not available.'));
            return false;
        }

        try {
            const challenge = await requestWalletChallenge(userId, 'refresh-verification', target);
            const signature = await tronWeb.trx.signMessageV2(challenge.message);

            await dispatch(refreshWalletVerificationThunk({
                userId,
                address: target,
                message: challenge.message,
                signature,
                nonce: challenge.nonce
            })).unwrap();

            console.log(`Wallet ${target} verification refreshed for user ${userId}`);
            return true;
        } catch (error) {
            const errorMessage = error instanceof Error
                ? error.message
                : 'Failed to refresh wallet verification.';
            dispatch(setConnectionError(errorMessage));
            console.warn('Wallet verification refresh failed:', error);
            return false;
        }
    }, [dispatch, userId, connectedAddress]);

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
     * End the user's verified session.
     *
     * Calls the backend logout endpoint, which downgrades `identityState`
     * to Registered (or Anonymous if no wallets remain) and clears
     * `identityVerifiedAt`. Wallets and the cookie persist; the next
     * verify-wallet click re-establishes the session. Also disconnects
     * the live TronLink connection so the user must re-engage the
     * extension on their next attempt.
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
        hasWallets,

        // Wallet login required state
        walletLoginRequired,
        existingWalletOwner,

        // Aliases for backwards compatibility
        address: connectedAddress,
        status: connectionStatus,
        error: connectionError,
        // User-level identity, freshness-aware. Was previously aliased
        // to the per-wallet `walletVerified` flag, which conflated
        // "this wallet has ever been signed" with "this user is
        // currently Verified". Stale-collapsed users now read as
        // not-Verified here, which lets the WalletButton route them
        // through the verify-wallet CTA instead of into a 404.
        isVerified: isUserVerified,

        // Actions
        connect,
        verify,
        refreshVerification,
        disconnect,
        signMessage,
        setStatus,
        logout,
        cancelWalletLogin
    } as const;
}
