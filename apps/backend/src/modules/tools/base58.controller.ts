import type { Request, Response } from 'express';
import TronWeb from 'tronweb';
import { z } from 'zod';
import { ValidationError } from '../../lib/errors.js';

const convertSchema = z
  .object({
    hex: z.string().trim().optional(),
    base58Check: z.string().trim().optional()
  })
  .refine(data => data.hex || data.base58Check, {
    message: 'Provide hex or base58Check'
  });

export class Base58Controller {
  hexToBase58 = async (req: Request, res: Response) => {
    const payload = convertSchema.parse(req.body);

    let { hex, base58Check } = payload;

    if (!base58Check && hex) {
      base58Check = convertHexToBase58(hex);
    }

    if (!hex && base58Check) {
      hex = convertBase58ToHex(base58Check);
    }

    if (!hex || !base58Check) {
      throw new ValidationError('Unable to convert address', { hex, base58Check });
    }

    res.json({
      success: true,
      transform: {
        hex,
        base58check: base58Check
      }
    });
  };
}

function convertHexToBase58(input: string): string {
  const hex = normalizeHex(input);
  try {
    return TronWeb.address.fromHex(hex);
  } catch (error) {
    throw new ValidationError('Invalid Tron hex address', { hex: input, error });
  }
}

function convertBase58ToHex(address: string): string {
  if (!address) {
    throw new ValidationError('Base58Check address is required');
  }
  try {
    return TronWeb.address.toHex(address).toUpperCase();
  } catch (error) {
    throw new ValidationError('Invalid Tron base58Check address', { address, error });
  }
}

function normalizeHex(input: string): string {
  let hex = input.trim();
  if (!hex) {
    throw new ValidationError('Hex value is required');
  }
  if (hex.startsWith('0x') || hex.startsWith('0X')) {
    hex = hex.slice(2);
  }
  if (hex.length === 40) {
    hex = `41${hex}`;
  }
  if (!/^41[0-9a-fA-F]{40}$/u.test(hex)) {
    throw new ValidationError('Invalid Tron hex address', { hex: input });
  }
  return hex.toUpperCase();
}
