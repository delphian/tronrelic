export interface TronWebProvider {
  ready?: boolean;
  defaultAddress?: {
    base58?: string;
  };
  request?: (args: { method: 'tron_requestAccounts' }) => Promise<void>;
  trx?: {
    signMessageV2?: (message: string) => Promise<string>;
  };
}

declare global {
  interface Window {
    tronWeb?: TronWebProvider;
  }
}

export function getTronWeb(): TronWebProvider | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }
  return window.tronWeb;
}

export function assertTronWeb(message = 'TronLink wallet not detected.') {
  const provider = getTronWeb();
  if (!provider) {
    throw new Error(message);
  }
  return provider;
}
