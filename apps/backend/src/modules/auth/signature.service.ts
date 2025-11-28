import TronWeb from 'tronweb';
import { ValidationError } from '../../lib/errors.js';

const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io'
});

export class SignatureService {
  async verifyMessage(address: string, message: string, signature: string) {
    const normalized = this.normalizeAddress(address);
    const isValid = await tronWeb.trx.verifyMessageV2(message, signature, normalized);
    if (!isValid) {
      throw new ValidationError('Invalid signature provided');
    }
    return normalized;
  }

  /**
   * Normalize a TRON address to base58 format.
   *
   * Accepts both hex (41-prefixed) and base58 (T-prefixed) addresses.
   *
   * @param address - TRON address in hex or base58 format
   * @returns Base58 encoded address
   * @throws ValidationError if address format is invalid
   */
  normalizeAddress(address: string): string {
    try {
      // Already base58 format (starts with T)
      if (address.startsWith('T') && address.length === 34) {
        // Validate it's a real address by round-tripping
        const hex = tronWeb.address.toHex(address);
        return tronWeb.address.fromHex(hex);
      }

      // Hex format (starts with 41 or 0x41)
      if (address.startsWith('41') || address.startsWith('0x41')) {
        return tronWeb.address.fromHex(address);
      }

      throw new Error('Unrecognized address format');
    } catch (error) {
      throw new ValidationError('Invalid TRON address provided', { address, error });
    }
  }
}
