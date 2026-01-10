export interface AddressTag {
  name: string;
  type: 'exchange' | 'contract' | 'bridge' | 'otc' | 'foundation' | 'service' | 'wallet';
  labels?: string[];
  notes?: string;
}

export const ADDRESS_TAGS: Record<string, AddressTag> = {
  TDqSquXBgUCLYvYC4XZgrprLK589dkhSCf: {
    name: 'Binance (Hot Wallet)',
    type: 'exchange',
    labels: ['cex', 'binance']
  },
  TV6MuMXfmLbBqPZvBHdwFsDnQeVfnmiuSi: {
    name: 'Binance (Deposit)',
    type: 'exchange',
    labels: ['cex', 'binance', 'deposit']
  },
  TAzsQ9Gx8eqFNFSKbeXrbi45CuVPHzA8wr: {
    name: 'Binance (Treasury)',
    type: 'exchange',
    labels: ['cex', 'binance']
  },
  TJDENsfBJs4RFETt1X1W8wMDc8M5XnJhCe: {
    name: 'Binance (Cold Wallet)',
    type: 'exchange',
    labels: ['cex', 'binance', 'cold']
  },
  TNXoiAJ3dct8Fjg4M9fkLFh9S2v9TXc32G: {
    name: 'Binance (Cold Wallet 2)',
    type: 'exchange',
    labels: ['cex', 'binance', 'cold']
  },
  TYASr5UV6HEcXatwdFQfmLVUqQQQMUxHLS: {
    name: 'Binance (Hot Wallet 2)',
    type: 'exchange',
    labels: ['cex', 'binance']
  },
  TQrY8tryqsYVCYS3MFbtffiPp2ccyn4STm: {
    name: 'Binance (Treasury 2)',
    type: 'exchange',
    labels: ['cex', 'binance']
  },
  TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX: {
    name: 'Binance (Reserve)',
    type: 'exchange',
    labels: ['cex', 'binance']
  },
  TT1DyeqXaaJkt6UhVYFWUXBXknaXnBudTK: {
    name: 'Binance (OTC)',
    type: 'exchange',
    labels: ['cex', 'binance', 'otc']
  },
  TVdW5S88GUPwNkMPKqpyG9CdLnhfw6zVXH: {
    name: 'Huobi Global',
    type: 'exchange',
    labels: ['cex', 'huobi']
  },
  TQ8bZVct1vZEB5P6FEz9sDcqC333kM6hLu: {
    name: 'OKX Hot Wallet',
    type: 'exchange',
    labels: ['cex', 'okx']
  },
  TA9ERm1k1iKxAYu8ZGY6K6B6znQKrGxa9p: {
    name: 'JustLend DAO',
    type: 'contract',
    labels: ['defi', 'lending']
  },
  TGzz8gjYiYRqpfmDwnLxfgPuLVNmpCswVp: {
    name: 'Sun.io Router',
    type: 'contract',
    labels: ['defi', 'dex']
  },
  TXYZopYRdj2D9XRtbG411XZZ3kM5VkAeBf: {
    name: 'TRON Foundation',
    type: 'foundation',
    labels: ['foundation', 'ecosystem']
  }
};

export function lookupAddressTag(address: string | undefined | null): AddressTag | null {
  if (!address) {
    return null;
  }
  return ADDRESS_TAGS[address] ?? null;
}