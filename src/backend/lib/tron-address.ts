import TronWeb from 'tronweb';
import { ValidationError } from './errors.js';

const tronWeb = new TronWeb({
  fullHost: 'https://api.trongrid.io'
});

const BASE58_REGEX = /^T[1-9A-HJ-NP-Za-km-z]{33}$/u;
const HEX_REGEX = /^41[0-9a-fA-F]{40}$/u;

export interface NormalizedAddress {
  base58: string;
  hex: string;
}

export function isBase58Address(value: string): boolean {
  return BASE58_REGEX.test(value.trim());
}

export function normalizeAddress(address: string): NormalizedAddress {
  if (!address || typeof address !== 'string') {
    throw new ValidationError('Address is required', { address });
  }

  const trimmed = address.trim();
  if (!trimmed) {
    throw new ValidationError('Address is required', { address });
  }

  if (isBase58Address(trimmed)) {
    try {
      const hex = tronWeb.address.toHex(trimmed).toUpperCase();
      ensureHexFormat(hex);
      return { base58: trimmed, hex };
    } catch (error) {
      throw new ValidationError('Invalid Tron address provided', { address, error });
    }
  }

  const hex = normalizeHex(trimmed);
  try {
    const base58 = tronWeb.address.fromHex(hex);
    return { base58, hex };
  } catch (error) {
    throw new ValidationError('Invalid Tron address provided', { address, error });
  }
}

export function toBase58Address(address: string): string {
  return normalizeAddress(address).base58;
}

export function toHexAddress(address: string): string {
  return normalizeAddress(address).hex;
}

/**
 * Read an address from untrusted input, such as an AI tool argument, and
 * return it in base58 only when it is a real TRON address.
 *
 * The shape checks in `normalizeAddress` accept a base58 string whose
 * checksum is wrong, which is what a mistyped or invented address usually
 * looks like. Converting to hex and back and requiring the same text catches
 * that, so a caller never reads an empty result for a made-up address as
 * "this wallet has nothing".
 *
 * @param address - The raw text, base58 (T…) or hex (41…).
 * @returns The base58 address, or null when the text is not a valid address.
 */
export function toVerifiedBase58(address: string): string | null {
  const text = typeof address === 'string' ? address.trim() : '';
  let base58: string | null = null;
  try {
    const normalized = normalizeAddress(text);
    base58 = tronWeb.address.fromHex(normalized.hex) || null;
    if (text.startsWith('T') && base58 !== text) {
      base58 = null;
    }
  } catch {
    base58 = null;
  }
  return base58;
}

function normalizeHex(input: string): string {
  let hex = input.trim();
  if (hex.startsWith('0x') || hex.startsWith('0X')) {
    hex = hex.slice(2);
  }

  if (hex.length === 40) {
    hex = `41${hex}`;
  }

  if (!HEX_REGEX.test(hex)) {
    throw new ValidationError('Invalid Tron hex address', { hex: input });
  }

  return hex.toUpperCase();
}

function ensureHexFormat(hex: string) {
  if (!HEX_REGEX.test(hex)) {
    throw new ValidationError('Invalid Tron hex address', { hex });
  }
}
