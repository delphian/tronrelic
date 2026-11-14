/**
 * @fileoverview The contract every way of identifying an MCP caller fulfils.
 *
 * The endpoint controller runs the same pipeline for both endpoints (kill
 * switch, Origin, method, body cap, served tools, SDK) and asks an
 * authenticator only one question: who is this, or why are they refused? Each
 * endpoint is built with its own authenticator. API keys, when they come, are
 * a third implementation placed in front of the anonymous one on the public
 * endpoint, so a request carrying a key is charged to the key's account and a
 * request without one falls through to anonymous.
 */

import type { Request } from 'express';
import type { McpEndpointKind } from '@/types';
import type { IMcpCaller } from './IMcpCaller.js';

/**
 * The result of identifying one request. Each kind maps to one HTTP answer in
 * the controller, so an authenticator never writes a response itself.
 *
 * - `ok` — admitted; `token` is the raw bearer token when there is one, which
 *   the SDK's auth info carries.
 * - `challenge` — refused with a bearer challenge that points the client at
 *   the protected resource metadata, which is what starts an OAuth sign-in.
 * - `refuse` — refused with a plain error and no challenge.
 * - `unavailable` — a store the check needs could not be read, so whether the
 *   caller may proceed is unknown; answered with a temporary 503.
 */
export type McpAuthOutcome =
    | { kind: 'ok'; caller: IMcpCaller; token?: string }
    | { kind: 'challenge'; status: 401 | 403; error?: string; description?: string }
    | { kind: 'refuse'; status: 400 | 403; error: string; description: string }
    | { kind: 'unavailable' };

/**
 * Identifies the caller of one MCP request.
 */
export interface IMcpCallerAuthenticator {
    /** The endpoint this authenticator serves. */
    readonly endpoint: McpEndpointKind;

    /**
     * Identify the caller from the request's headers and address. Called
     * before the body is read, so it must not touch `req.body`.
     *
     * @param req - The incoming request, body not yet parsed.
     * @returns Who the caller is, or why the request is refused.
     */
    authenticate(req: Request): Promise<McpAuthOutcome>;
}
