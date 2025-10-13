type TronWebAddress = {
  fromHex: (hex: string) => string;
  toHex: (base58: string) => string;
};

type TronWebUtils = {
  crypto: {
    getBase58CheckAddress: (address: string) => string;
  };
  address: TronWebAddress;
};

declare module 'tronweb' {
  export default class TronWeb {
    constructor(options: { fullHost: string });
    static utils: TronWebUtils;
    static address: TronWebAddress;
    utils: TronWebUtils;
    address: TronWebAddress;
    trx: {
      verifyMessageV2: (message: string, signature: string, address: string) => Promise<boolean>;
    };
  }
}
