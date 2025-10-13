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

  normalizeAddress(address: string) {
    try {
      return tronWeb.utils.crypto.getBase58CheckAddress(address);
    } catch (error) {
      throw new ValidationError('Invalid TRON address provided', { address, error });
    }
  }
}
