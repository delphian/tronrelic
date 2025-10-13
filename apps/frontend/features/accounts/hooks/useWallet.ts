'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useAppDispatch, useAppSelector } from '../../../store/hooks';
import {
  resetWalletState,
  setProviderDetected,
  setWalletAddress,
  setWalletError,
  setWalletStatus,
  type WalletStatus
} from '../slice';
import { getTronWeb } from '../../../lib/tronWeb';

const detectionIntervals = 12;
const detectionDelay = 500;

export function useWallet() {
  const dispatch = useAppDispatch();
  const wallet = useAppSelector(state => state.wallet);
  const detectionAttempts = useRef(0);

  const detectProvider = useCallback(() => {
    if (typeof window === 'undefined') {
      return;
    }

  const tronWeb = getTronWeb();
    const detected = Boolean(tronWeb);
    if (detected !== wallet.providerDetected) {
      dispatch(setProviderDetected(detected));
    }

    if (tronWeb?.defaultAddress?.base58) {
      const address = tronWeb.defaultAddress.base58;
      if (address && address !== wallet.address) {
        dispatch(setWalletAddress(address));
        dispatch(setWalletStatus('connected'));
      }
    }
  }, [dispatch, wallet.address, wallet.providerDetected]);

  useEffect(() => {
    if (wallet.address) {
      return;
    }

    detectionAttempts.current = 0;
    dispatch(setWalletStatus(wallet.providerDetected ? 'checking' : 'idle'));

    const interval = setInterval(() => {
      detectionAttempts.current += 1;
      detectProvider();

      if (wallet.address || detectionAttempts.current > detectionIntervals) {
        clearInterval(interval);
      }
    }, detectionDelay);

    return () => clearInterval(interval);
  }, [detectProvider, dispatch, wallet.address, wallet.providerDetected]);

  const setStatus = useCallback(
    (status: WalletStatus) => {
      dispatch(setWalletStatus(status));
    },
    [dispatch]
  );

  const connect = useCallback(async () => {
    if (typeof window === 'undefined') {
      return;
    }

  const tronWeb = getTronWeb();
    if (!tronWeb) {
      dispatch(setWalletError('TronLink wallet not detected. Install TronLink or open this page in the TronLink browser.'));
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
      dispatch(setWalletAddress(address));
      setStatus('connected');
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unable to connect to TronLink wallet.';
      dispatch(setWalletError(message));
    }
  }, [dispatch, setStatus]);

  const disconnect = useCallback(() => {
    dispatch(resetWalletState());
  }, [dispatch]);

  const signMessage = useCallback(async (message: string) => {
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
    ...wallet,
    connect,
    disconnect,
    signMessage,
    setStatus
  } as const;
}
