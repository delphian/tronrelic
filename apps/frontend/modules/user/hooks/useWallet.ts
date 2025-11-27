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
    linkWalletThunk,
    selectUserId,
    selectUserInitialized,
    type WalletConnectionStatus
} from '../slice';
import { getTronWeb } from '../lib';

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

    const detectionAttempts = useRef(0);
    const linkAttempted = useRef<string | null>(null);

    /**
     * Detect TronLink provider and auto-connect if already authorized.
     */
    const detectProvider = useCallback(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const tronWeb = getTronWeb();
        const detected = Boolean(tronWeb);

        if (detected !== providerDetected) {
            dispatch(setProviderDetected(detected));
        }

        // Auto-connect if TronLink has an address available
        if (tronWeb?.defaultAddress?.base58) {
            const address = tronWeb.defaultAddress.base58;
            if (address && address !== connectedAddress) {
                dispatch(setConnectedAddress(address));
                dispatch(setConnectionStatus('connected'));
            }
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

        // Auto-link the connected wallet to the user's identity
        const linkWallet = async () => {
            try {
                const tronWeb = getTronWeb();
                if (!tronWeb?.trx?.signMessageV2) {
                    console.warn('TronLink signature capability not available for auto-link');
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

                console.log(`Wallet ${connectedAddress} linked to user ${userId}`);
            } catch (error) {
                // Don't treat link failure as connection failure
                // User is still connected to TronLink, just not persisted
                console.warn('Failed to auto-link wallet:', error);
            }
        };

        linkWallet();
    }, [dispatch, userId, userInitialized, connectedAddress]);

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
     */
    const connect = useCallback(async () => {
        if (typeof window === 'undefined') {
            return;
        }

        const tronWeb = getTronWeb();
        if (!tronWeb) {
            dispatch(setConnectionError(
                'TronLink wallet not detected. Install TronLink or open this page in the TronLink browser.'
            ));
            return;
        }

        try {
            setStatus('connecting');

            if (tronWeb.request) {
                await tronWeb.request({ method: 'tron_requestAccounts' });
            }

            const address = tronWeb.defaultAddress?.base58;
            if (!address) {
                throw new Error('Wallet address unavailable after connection request.');
            }

            dispatch(setConnectedAddress(address));
            setStatus('connected');
        } catch (error) {
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
        isConnected: connectionStatus === 'connected' && connectedAddress !== null,

        // Aliases for backwards compatibility
        address: connectedAddress,
        status: connectionStatus,
        error: connectionError,

        // Actions
        connect,
        disconnect,
        signMessage,
        setStatus
    } as const;
}
