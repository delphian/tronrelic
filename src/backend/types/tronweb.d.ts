type TronWebAddress = {
  fromHex: (hex: string) => string;
  toHex: (base58: string) => string;
};

type TronWebUtils = {
  crypto: {
    getBase58CheckAddress: (address: string) => string;
  };
  address: TronWebAddress;
  accounts: {
    /** Generates a random keypair locally, with no network call. */
    generateAccount: () => { privateKey: string; publicKey: string; address: { base58: string; hex: string } };
  };
};

declare module 'tronweb' {
  export default class TronWeb {
    constructor(options: { fullHost: string; privateKey?: string });
    static utils: TronWebUtils;
    static address: TronWebAddress;
    utils: TronWebUtils;
    address: TronWebAddress;
    trx: {
      /**
       * Recovers the base58 address that produced `signature` over `message`.
       * It does not compare against any address and never returns false: a
       * mismatched signature recovers to a different address, and a malformed
       * one throws. Callers must compare the result with the expected signer.
       */
      verifyMessageV2: (message: string, signature: string) => Promise<string>;
      /** Signs `message` locally with `privateKey` in the TronLink V2 format. */
      signMessageV2: (message: string, privateKey: string) => Promise<string>;
    };
    setHeader: (headers: Record<string, string>) => void;
  }
}
