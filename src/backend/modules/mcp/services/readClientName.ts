/**
 * @fileoverview Reads the self-reported client label both MCP authenticators
 * attach to a caller.
 */

import type { Request } from 'express';

/** Longest client label kept, so a caller cannot store an unbounded string per call. */
const MAX_CLIENT_NAME_LENGTH = 120;

/**
 * Read the request's `User-Agent` as a short label for the accounting rows.
 *
 * The MCP transport here is stateless, so the client's handshake name is only
 * on its `initialize` request and not on the tool calls that follow; the
 * header is the one label every request carries. The caller chooses it, so it
 * is kept to printable ASCII and a fixed length and treated as a label only.
 *
 * @param req - The incoming request.
 * @returns The cleaned label, or undefined when the header is missing or empty.
 */
export function readClientName(req: Request): string | undefined {
    const raw = req.get('user-agent') ?? '';
    const cleaned = raw.replace(/[^\x20-\x7e]/g, '').trim().slice(0, MAX_CLIENT_NAME_LENGTH);
    return cleaned.length > 0 ? cleaned : undefined;
}
