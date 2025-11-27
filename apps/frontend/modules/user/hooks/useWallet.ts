'use client';

/**
 * TronLink wallet connection hook with auto-link to User Module.
 *
 * Provides wallet connection functionality via TronLink browser extension.
 * When a user connects their wallet, it is automatically linked to their
 * User Module identity in the backend.
 *
 * @example
 * ```tsx
 * const { connectedAddress, connect, disconnect, isConnected } = useWallet();
 *
 * return isConnected ? (
 *   <button onClick={disconnect}>{connectedAddress}</button>
 * ) : (
 *   <button onClick={connect}>Connect Wallet</button>
 * );
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
    connectWalletThunk,
    linkWalletThunk,
    selectUserId,
    selectUserInitialized,
    selectWallets,
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

    const detectionAttempts = useRef(0);
    const linkAttempted = useRef<string | null>(null);

    /**
     * Detect TronLink provider and auto-connect if already authorized.
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

        // Auto-connect if TronLink is ready with an address
        const address = tronLink?.tronWeb?.defaultAddress?.base58 ?? tronWeb?.defaultAddress?.base58;
        if (address && address !== connectedAddress) {
            dispatch(setConnectedAddress(address));
            dispatch(setConnectionStatus('connected'));
        }
    }, [dispatch, connectedAddress, providerDetected]);

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
     * Auto-link wallet to User Module when connected.
     *
     * Two-step flow:
     * 1. Connect: Store wallet as unverified in backend
     * 2. Verify: Request signature and update to verified
     */
    useEffect(() => {
        // Only attempt link when:
        // 1. User is initialized (has userId)
        // 2. Wallet is connected
        // 3. We haven't already attempted to link this address
        if (!userInitialized || !userId || !connectedAddress) {
            return;
        }

        if (linkAttempted.current === connectedAddress) {
            return;
        }

        linkAttempted.current = connectedAddress;

        // Two-step wallet linking flow
        const linkWallet = async () => {
            // Step 1: Connect wallet (stores as unverified)
            try {
                await dispatch(connectWalletThunk({
                    userId,
                    address: connectedAddress
                })).unwrap();
                console.log(`Wallet ${connectedAddress} connected to user ${userId}`);
            } catch (error) {
                // Connection failed - could be invalid address or already linked to another user
                console.warn('Failed to connect wallet:', error);
                dispatch(setWalletVerified(false));
                return;
            }

            // Step 2: Attempt verification (optional - user can reject)
            try {
                const tronWeb = getTronWeb();
                if (!tronWeb?.trx?.signMessageV2) {
                    console.warn('TronLink signature capability not available for verification');
                    dispatch(setWalletVerified(false));
                    return;
                }

                const timestamp = Date.now();
                const message = `Link wallet ${connectedAddress} to TronRelic identity ${userId} at ${timestamp}`;
                const signature = await tronWeb.trx.signMessageV2(message);

                await dispatch(linkWalletThunk({
                    userId,
                    address: connectedAddress,
                    message,
                    signature,
                    timestamp
                })).unwrap();

                dispatch(setWalletVerified(true));
                console.log(`Wallet ${connectedAddress} verified and linked to user ${userId}`);
            } catch (error) {
                // Verification failed - wallet remains connected but unverified
                dispatch(setWalletVerified(false));
                console.warn('Wallet connected but not verified:', error);
            }
        };

        linkWallet();
    }, [dispatch, userId, userInitialized, connectedAddress]);

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

    return {
        // State
        connectedAddress,
        connectionStatus,
        providerDetected,
        connectionError,
        walletVerified,
        isConnected: connectionStatus === 'connected' && connectedAddress !== null,

        // Aliases for backwards compatibility
        address: connectedAddress,
        status: connectionStatus,
        error: connectionError,
        isVerified: walletVerified,

        // Actions
        connect,
        disconnect,
        signMessage,
        setStatus
    } as const;
}
