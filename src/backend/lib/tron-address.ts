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
