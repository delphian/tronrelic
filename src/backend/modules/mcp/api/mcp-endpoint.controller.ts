/**
 * @fileoverview HTTP handling for both MCP endpoints: `/mcp`, which serves
 * members and anonymous callers, and `/mcp/public`, an anonymous-only alias.
 *
 * One controller class serves both, built twice with a different
 * authenticator. Every request passes these checks in order before the SDK:
 * kill switch (503), browser `Origin` (403), method (405), token in the query
 * string (400), then the authenticator. On `/mcp` a request with credentials
 * is a member, and a bad token is a 401 so the client refreshes; one without
 * is anonymous. On `/mcp/public` every request is anonymous. A store a check
 * needs being down is a 503, never a 401. Only then is the body parsed, with a
 * small size cap.
 *
 * On `/mcp`, an anonymous caller is also shown the member tools as "sign in to
 * use", and a call to one is answered with a 401 before the SDK runs, which is
 * what makes Claude and ChatGPT ask the user to sign in (lazy authentication).
 * Everything else rides into the SDK on `req.auth`. A call for a tool that was
 * not listed is logged and counted first, with the reason it was withheld,
 * because the SDK answers it with a bare "Tool not found".
 */

import express from 'express';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { createMcpHandler, isJSONRPCRequest } from '@modelcontextprotocol/server';
import type { AuthInfo, McpRequestContext, McpServer } from '@modelcontextprotocol/server';
import { originValidation, toNodeHandler } from '@modelcontextprotocol/node';
import type { ISystemLogService } from '@/types';
import { MCP_OAUTH_SCOPES } from '@/types';
import type { McpSettingsStore } from '../services/mcp-settings.store.js';
import type { IMcpServedTool, IMcpToolAudience, McpToolExposureService } from '../services/mcp-tool-exposure.service.js';
import type { IMcpCaller } from '../services/IMcpCaller.js';
import type { IMcpCallerAuthenticator, McpAuthOutcome } from '../services/IMcpCallerAuthenticator.js';
import type { IMcpCallMeter } from '../services/IMcpCallMeter.js';
import type { McpServerFactory } from '../services/mcp-server.factory.js';

/** Largest JSON body the endpoint accepts. Tool arguments are small; this is generous. */
const MAX_BODY_BYTES = '256kb';

/**
 * Most refused tool calls logged for one request. A JSON-RPC batch can name
 * many tools, and without a cap one request could write an error entry per
 * name into the system log.
 */
const MAX_WITHHELD_CALLS_LOGGED = 10;

/** Most tool names logged and counted for one request answered with a sign-in challenge. */
const MAX_SIGN_IN_CALLS_LOGGED = 10;

/**
 * Public URLs that describe one endpoint to clients, and whether it offers
 * sign-in from an anonymous session.
 */
export interface IMcpEndpointUrls {
    /** The endpoint URL; on `/mcp`, also the audience every access token must carry. */
    resourceUrl: string;

    /**
     * Where the protected resource metadata document is served, named in
     * bearer challenges. Only the signed-in endpoint challenges, so the
     * public endpoint leaves it unset.
     */
    resourceMetadataUrl?: string;

    /** Host names a browser `Origin` header may name. */
    allowedOriginHosts: string[];

    /**
     * The group whose tools an anonymous caller is shown as "sign in to use"
     * (lazy authentication). Set on `/mcp` to `mcp-users`, the group every
     * account joins, so an anonymous caller's model can ask for a member tool
     * and the 401 that answers it starts sign-in on the same connector. Left
     * unset on `/mcp/public`, which never challenges.
     */
    signInGroupId?: string;
}

/** What the SDK receives on `req.auth.extra` for one request. */
interface IMcpRequestExtra {
    caller: IMcpCaller;
    tools: IMcpServedTool[];
    [key: string]: unknown;
}

/**
 * Serves `POST /mcp` or `POST /mcp/public`, depending on its authenticator.
 */
export class McpEndpointController {
    private readonly nodeHandler: ReturnType<typeof toNodeHandler>;
    private readonly checkOrigin: ReturnType<typeof originValidation>;
    private readonly parseBody: RequestHandler = express.json({ limit: MAX_BODY_BYTES });

    /**
     * @param settings - The kill switch, read on every request.
     * @param exposure - Computes the tools served to each caller from their groups and address.
     * @param authenticator - Decides who the caller is for this endpoint.
     * @param serverFactory - Builds the per-request MCP server.
     * @param urls - Public URLs used in challenges and the Origin check.
     * @param meter - Counts refused calls in the accounting table; calls that
     *   reach the governor are counted from its audit hook instead.
     * @param logger - Module logger.
     */
    constructor(
        private readonly settings: McpSettingsStore,
        private readonly exposure: McpToolExposureService,
        private readonly authenticator: IMcpCallerAuthenticator,
        serverFactory: McpServerFactory,
        private readonly urls: IMcpEndpointUrls,
        private readonly meter: IMcpCallMeter,
        private readonly logger: ISystemLogService
    ) {
        const handler = createMcpHandler(
            /**
             * Build the per-request server from the verified caller and the
             * tools the controller attached, so each request sees only the
             * tools served to that caller.
             *
             * @param ctx - The SDK's request context, carrying `authInfo.extra`.
             * @returns A server registering only the caller's tools.
             * @throws When no verified caller is attached, because that means
             *   the request skipped the controller's checks.
             */
            (ctx: McpRequestContext): McpServer => {
                const extra = ctx.authInfo?.extra as IMcpRequestExtra | undefined;
                if (!extra) {
                    // The controller always sets req.auth before the SDK runs;
                    // reaching here means that wiring broke, so refuse rather
                    // than build a server with no caller.
                    throw new Error('MCP request reached the SDK without a verified caller.');
                }
                return serverFactory.create(extra.caller, extra.tools);
            },
            {
                /**
                 * Record an error the SDK hit while handling a request, so a
                 * failure it answered on its own still reaches the module's logs.
                 *
                 * @param error - Whatever the SDK caught.
                 */
                onerror: (error: unknown) => this.logger.warn({ err: error, endpoint: this.authenticator.endpoint }, 'MCP handler error')
            }
        );
        this.nodeHandler = toNodeHandler(handler, {
            /**
             * Record a failure in the Node adapter itself (reading the request
             * or writing the response), which the SDK handler never sees.
             *
             * @param error - Whatever the adapter caught.
             */
            onerror: (error: unknown) => this.logger.error({ err: error, endpoint: this.authenticator.endpoint }, 'MCP Node adapter error')
        });
        this.checkOrigin = originValidation(urls.allowedOriginHosts);
    }

    /**
     * Handle one request to the endpoint. Mounted with `app.all` so non-POST
     * methods get a proper 405 rather than Express's 404.
     *
     * @param req - The Express request; its body has not been parsed yet.
     * @param res - The Express response.
     * @param next - Passed any unexpected error, for the global error handler.
     * @returns Resolves when the response has been handed off or written.
     *   Declared as an arrow property so it can be mounted without `.bind(this)`.
     */
    handle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
        try {
            const admitted = await this.admit(req, res);
            if (admitted) {
                await this.runParser(req, res);
                // A rejected body (too large or malformed) has already been answered.
                if (!res.headersSent) {
                    await this.dispatch(req, res, admitted);
                }
            }
        } catch (error: unknown) {
            next(error);
        }
    };

    /**
     * Apply every check that runs before the body is read, writing the
     * refusal when one fails.
     *
     * @param req - The incoming request, body not yet parsed.
     * @param res - The response, written when the request is refused.
     * @returns The admitted caller and their raw token when they sent one, or
     *   null when the request was refused and a response has been written.
     */
    private async admit(req: Request, res: Response): Promise<{ caller: IMcpCaller; token?: string } | null> {
        let admitted: { caller: IMcpCaller; token?: string } | null = null;
        const switchState = await this.readSwitchState();
        if (switchState === 'unknown') {
            this.unavailable(res);
        } else if (switchState === 'off') {
            res.status(503).set('Retry-After', '3600').json({ error: 'unavailable', error_description: 'The MCP endpoint is switched off.' });
        } else if (!this.checkOrigin(req, res)) {
            // originValidation has already written a 403.
        } else if (req.method !== 'POST') {
            res.status(405).set('Allow', 'POST').json({ error: 'method_not_allowed', error_description: 'Use POST.' });
        } else if (typeof req.query.access_token !== 'undefined') {
            // Tokens in URLs end up in logs and browser history; the MCP
            // authorization spec forbids accepting them.
            res.status(400).json({ error: 'invalid_request', error_description: 'Send credentials in the Authorization header, never in the URL.' });
        } else {
            admitted = this.applyOutcome(await this.authenticator.authenticate(req), res);
        }
        return admitted;
    }

    /**
     * Turn the authenticator's verdict into an admitted caller or a written
     * refusal.
     *
     * @param outcome - What the authenticator decided.
     * @param res - The response, written when the request is refused.
     * @returns The admitted caller, or null when a refusal was written.
     */
    private applyOutcome(outcome: McpAuthOutcome, res: Response): { caller: IMcpCaller; token?: string } | null {
        let admitted: { caller: IMcpCaller; token?: string } | null = null;
        if (outcome.kind === 'unavailable') {
            this.unavailable(res);
        } else if (outcome.kind === 'challenge') {
            this.challenge(res, outcome.status, outcome.error, outcome.description);
        } else if (outcome.kind === 'refuse') {
            res.status(outcome.status).json({ error: outcome.error, error_description: outcome.description });
        } else {
            admitted = { caller: outcome.caller, ...(outcome.token ? { token: outcome.token } : {}) };
        }
        return admitted;
    }

    /**
     * Read the kill switch without letting a storage failure escape.
     *
     * An endpoint that cannot tell whether it is switched on must behave as
     * switched off, and the client should see that as a temporary 503 rather
     * than the global handler's 500. A failed read is logged and reported as
     * `'unknown'` so the caller can answer with a short `Retry-After`, since
     * the database is usually back well before an operator's hour-long off.
     *
     * @returns `'on'` or `'off'` from the stored settings, or `'unknown'` when
     *   the settings could not be read.
     */
    private async readSwitchState(): Promise<'on' | 'off' | 'unknown'> {
        let state: 'on' | 'off' | 'unknown';
        try {
            const settings = await this.settings.get();
            state = settings.enabled ? 'on' : 'off';
        } catch (error: unknown) {
            this.logger.error({ err: error }, 'Could not read the MCP kill switch; refusing the request');
            state = 'unknown';
        }
        return state;
    }

    /**
     * Hand an admitted request to the MCP SDK.
     *
     * The tools served to this caller are computed now, per request, from
     * their groups and address, so an approval, a withdrawal, or a group
     * setting changed on the admin page applies to the next call. The caller
     * and tools ride on `req.auth.extra`, which is how the SDK passes
     * per-request data to the server factory.
     *
     * @param req - The request, body parsed.
     * @param res - The response the SDK writes.
     * @param admitted - The admitted caller and their raw token, when they sent one.
     * @returns Resolves when the SDK has written the response.
     */
    private async dispatch(req: Request, res: Response, admitted: { caller: IMcpCaller; token?: string }): Promise<void> {
        const { caller, token } = admitted;
        const tools = await this.readServedTools(caller);
        if (tools === null) {
            // The approvals store is down. Answer the same temporary 503 as a
            // failed kill-switch or grant read, not the global handler's 500.
            this.unavailable(res);
        } else {
            const signInTools = await this.readSignInTools(caller, tools);
            const signInNames = new Set(signInTools.map(entry => entry.tool.name));
            const needsSignIn = calledToolNames(req.body).filter(name => signInNames.has(name));
            if (needsSignIn.length > 0) {
                this.askToSignIn(res, caller, needsSignIn);
            } else {
                const listed = [...tools, ...signInTools];
                await this.recordWithheldCalls(req.body, caller, listed);
                await this.handOff(req, res, caller, token, listed);
            }
        }
    }

    /**
     * Work out which member tools to show an anonymous caller as "sign in to
     * use".
     *
     * Claude and ChatGPT start sign-in only when the model calls a tool that
     * needs an account and the server answers 401, so the model has to see
     * those tools first. They are the tools a member of the sign-in group
     * would be served from this address, minus the ones already served
     * anonymously. Restricted tools can never be granted to that group, so
     * none appear here. A failure to read them is logged and leaves the
     * anonymous tools working, because sign-in is an extra, not a requirement.
     *
     * @param caller - The admitted caller.
     * @param served - The tools already served to them.
     * @returns The tools to list as needing sign-in; empty for members, on an
     *   endpoint without sign-in, or when they could not be read.
     */
    private async readSignInTools(caller: IMcpCaller, served: IMcpServedTool[]): Promise<IMcpServedTool[]> {
        let signInTools: IMcpServedTool[] = [];
        if (this.urls.signInGroupId && caller.principalKind === 'anonymous') {
            try {
                const servedNames = new Set(served.map(entry => entry.tool.name));
                const memberTools = await this.exposure.getServedTools({ groups: [this.urls.signInGroupId], ip: caller.ip });
                signInTools = memberTools
                    .filter(entry => !servedNames.has(entry.tool.name))
                    .map(entry => ({ ...entry, requiresSignIn: true }));
            } catch (error: unknown) {
                this.logger.warn({ err: error }, 'Could not read the member tools to show anonymous MCP callers; listing anonymous tools only');
            }
        }
        return signInTools;
    }

    /**
     * Answer an anonymous call to a member tool with the 401 that starts
     * sign-in, and count it.
     *
     * This has to happen before the SDK runs: a tool result is always sent
     * inside a 200, and Claude ignores a sign-in request on a 200. After the
     * user signs in, the client retries the same call with a token. The
     * refusal is counted in the accounting table as `sign-in-required` so the
     * usage view shows how often visitors are asked to sign in; it is not
     * charged to any limit, because no tool ran.
     *
     * @param res - The response the challenge is written to.
     * @param caller - The anonymous caller.
     * @param toolNames - The member tools the request asked for.
     */
    private askToSignIn(res: Response, caller: IMcpCaller, toolNames: string[]): void {
        for (const name of toolNames.slice(0, MAX_SIGN_IN_CALLS_LOGGED)) {
            this.meter.recordWithheld(caller, name, 'sign-in-required');
        }
        this.logger.info({ principalId: caller.principalId, tools: toolNames.slice(0, MAX_SIGN_IN_CALLS_LOGGED) }, 'Anonymous MCP caller asked to sign in for a member tool');
        this.challenge(res, 401, 'invalid_token', 'Sign in to a free TronRelic account to use this tool.');
    }

    /**
     * Log and count each tool the request asks to run that was not served to
     * this caller.
     *
     * The SDK refuses such a call with "Tool not found" and nothing else, so
     * without this entry an admin cannot tell an IP allowlist refusal from a
     * missing grant, a switched-off group, or a stale one. The reason comes
     * from the exposure service, which applies the same checks that built the
     * served list. A failure to work out the reason is logged too, and never
     * stops the request, which the SDK still answers. From an anonymous caller
     * a refusal is a stranger probing for tools, which is expected traffic, so
     * it is logged at `warn` rather than `error`.
     *
     * @param body - The parsed JSON-RPC body: one message, or a batch.
     * @param caller - The admitted caller, named in each entry.
     * @param tools - The tools served to this caller for this request.
     * @returns Resolves once every entry has been written.
     */
    private async recordWithheldCalls(body: unknown, caller: IMcpCaller, tools: IMcpServedTool[]): Promise<void> {
        const served = new Set(tools.map(entry => entry.tool.name));
        const withheld = calledToolNames(body).filter(name => !served.has(name)).slice(0, MAX_WITHHELD_CALLS_LOGGED);
        const context = {
            endpoint: caller.endpoint,
            principalKind: caller.principalKind,
            principalId: caller.principalId,
            clientId: caller.claims?.clientId,
            ip: caller.ip,
            groups: caller.groups
        };
        const level = caller.principalKind === 'anonymous' ? 'warn' : 'error';
        for (const name of withheld) {
            let reason: string;
            try {
                // Null means a grant or setting changed after the served list
                // was built, so the tool would be served on the next call.
                reason = (await this.exposure.explainWithheld(name, audienceOf(caller))) ?? 'changed-during-request';
                this.logger[level]({ ...context, tool: name, reason }, `MCP tool call refused: ${name} is not served to this caller (${reason})`);
            } catch (error: unknown) {
                reason = 'reason-unavailable';
                this.logger[level]({ ...context, tool: name, err: error }, `MCP tool call refused: ${name} is not served to this caller (reason unavailable)`);
            }
            this.meter.recordWithheld(caller, name, reason);
        }
    }

    /**
     * Read the served tool list without letting a storage failure escape, so
     * the client sees a temporary 503 rather than a 500 it cannot act on.
     *
     * @param caller - The admitted caller, whose groups and address decide what is served.
     * @returns The served tools, or null when the approvals or group settings
     *   could not be read.
     */
    private async readServedTools(caller: IMcpCaller): Promise<IMcpServedTool[] | null> {
        let tools: IMcpServedTool[] | null;
        try {
            tools = await this.exposure.getServedTools(audienceOf(caller));
        } catch (error: unknown) {
            this.logger.error({ err: error }, 'Could not read MCP tool approvals; refusing the request');
            tools = null;
        }
        return tools;
    }

    /**
     * Attach the caller and their tools to the request and pass it to the MCP
     * SDK, which builds the per-request server and writes the reply.
     *
     * @param req - The request, body parsed.
     * @param res - The response the SDK writes.
     * @param caller - The admitted caller.
     * @param token - The caller's raw bearer token, which the SDK's auth info
     *   carries; empty for an anonymous caller.
     * @param tools - The tools served to this caller.
     * @returns Resolves when the SDK has written the response.
     */
    private async handOff(req: Request, res: Response, caller: IMcpCaller, token: string | undefined, tools: IMcpServedTool[]): Promise<void> {
        const extra: IMcpRequestExtra = { caller, tools };
        const authInfo: AuthInfo = {
            token: token ?? '',
            clientId: caller.claims?.clientId ?? caller.principalKind,
            scopes: caller.claims?.scopes ?? [],
            ...(caller.claims?.expiresAt ? { expiresAt: caller.claims.expiresAt } : {}),
            resource: new URL(this.urls.resourceUrl),
            extra
        };
        (req as Request & { auth?: AuthInfo }).auth = authInfo;
        await this.nodeHandler(req, res, req.body);
    }

    /**
     * Run the size-capped JSON parser as a promise.
     *
     * A malformed or oversized body makes the parser call back with an error.
     * That is the client's fault, so it is answered here as a 400 or 413
     * rather than passed to the global handler as a server error.
     *
     * @param req - The request whose body to parse.
     * @param res - The response, written only when the body is rejected.
     * @returns Resolves once the body is parsed or the rejection is written.
     */
    private runParser(req: Request, res: Response): Promise<void> {
        return new Promise(resolve => {
            this.parseBody(req, res, (error?: unknown) => {
                if (error) {
                    const status = (error as { status?: number }).status === 413 ? 413 : 400;
                    res.status(status).json({ error: 'invalid_request', error_description: status === 413 ? 'Request body is too large.' : 'Request body is not valid JSON.' });
                }
                resolve();
            });
        });
    }

    /**
     * Answer a temporary 503: a store the request needed could not be read.
     *
     * @param res - The response to write.
     */
    private unavailable(res: Response): void {
        res.status(503).set('Retry-After', '30').json({ error: 'unavailable', error_description: 'The MCP endpoint is temporarily unavailable.' });
    }

    /**
     * Write a bearer challenge.
     *
     * The `resource_metadata` parameter is what tells an MCP client where to
     * learn which authorization server to use (RFC 9728). `scope` names the
     * scopes to request. Clients prefer it over the metadata document's list,
     * so it carries `offline_access` too; without it the client gets no
     * refresh token and the user signs in again every 15 minutes.
     *
     * @param res - The response to write.
     * @param status - 401 for missing or invalid credentials, 403 for a missing scope.
     * @param error - OAuth error code, omitted when no token was sent at all.
     * @param description - Human-readable explanation for the client's logs.
     */
    private challenge(res: Response, status: 401 | 403, error?: string, description?: string): void {
        const params = [`scope="${MCP_OAUTH_SCOPES.join(' ')}"`];
        if (this.urls.resourceMetadataUrl) {
            params.unshift(`resource_metadata="${this.urls.resourceMetadataUrl}"`);
        }
        if (error) {
            params.unshift(`error="${error}"`);
        }
        if (description) {
            params.push(`error_description="${description.replace(/"/g, "'")}"`);
        }
        res.status(status)
            .set('WWW-Authenticate', `Bearer ${params.join(', ')}`)
            .json({ error: error ?? 'unauthorized', ...(description ? { error_description: description } : {}) });
    }
}

/**
 * Describe a caller the way the exposure service needs it.
 *
 * Building the served list and explaining a refused call must look at the
 * same groups and address, or the logged reason could disagree with what was
 * actually served, so both go through this one function.
 */
function audienceOf(caller: IMcpCaller): IMcpToolAudience {
    return { groups: caller.groups, ip: caller.ip };
}

/**
 * List the tool names a JSON-RPC body asks to run.
 *
 * The body is the client's input and has only been checked to be JSON, so each
 * message is tested against the SDK's own JSON-RPC request check before its
 * fields are read. That keeps the refusal log accurate: a message missing
 * `jsonrpc` or an id is answered by the SDK as an invalid request and never
 * reaches a tool, so counting it would log a refusal that never happened. A
 * body may hold one message or a batch of them; each name appears once in the
 * result.
 *
 * @param body - The parsed request body.
 * @returns The `params.name` of every valid `tools/call` request, without duplicates.
 */
function calledToolNames(body: unknown): string[] {
    const names = new Set<string>();
    const messages: unknown[] = Array.isArray(body) ? body : [body];
    for (const message of messages) {
        if (isJSONRPCRequest(message)) {
            const { method, params } = message as { method?: unknown; params?: unknown };
            const name = typeof params === 'object' && params !== null ? (params as { name?: unknown }).name : undefined;
            if (method === 'tools/call' && typeof name === 'string') {
                names.add(name);
            }
        }
    }
    return [...names];
}
