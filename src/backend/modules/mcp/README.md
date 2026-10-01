# MCP Module

TronRelic's Model Context Protocol (MCP) endpoint. Members of the `mcp-users` group connect their own AI client (Claude, Claude Desktop, Claude Code, Cursor) to `https://<site>/mcp`, sign in once in the browser, and call the read-only AI tools an admin has approved. The identity module is the OAuth 2.1 authorization server; this module is the protected resource. Every tool call runs through the AI tool governor under the `mcp` trigger path.

## Agent Quick Surface

| Surface | Value |
|---|---|
| Module id | `mcp` |
| Module class | `src/backend/modules/mcp/McpModule.ts` |
| Endpoint | `POST /mcp` (stateless Streamable HTTP, MCP 2026-07-28; 2025-era clients served by the SDK's legacy path). Other methods answer `405` |
| Discovery | `GET /.well-known/oauth-protected-resource/mcp` and `GET /.well-known/oauth-protected-resource` (RFC 9728). The authorization server metadata at `/.well-known/oauth-authorization-server` is served by the identity module |
| Admin page | `/system/mcp` (menu item `MCP`, order 46): kill switch above the tab row; tabs Overview · Tools · Connected apps · Activity · Database · Logs |
| Admin API base | `/api/admin/mcp` (rate-limited + `requireAdmin`) |
| Types package | `@delphian/tronrelic-types` → `IMcpSettings`, `IMcpStatus`, `IMcpToolExposure`, `IMcpAccessTokenClaims`, `IMcpAccessTokenVerifier`, `MCP_TOOLS_SCOPE`, `MCP_OAUTH_SCOPES`, `MCP_USERS_GROUP_ID`, `getMcpToolIneligibility`, `IToolInvocationOrigin` |
| Owned collections | `module_mcp_settings` (one document: the kill switch), `module_mcp_tool_approvals` (one per approved tool) |
| OAuth tables | Owned by identity: `module_user_auth_oauth_*`, `module_user_auth_jwks` |
| User group | `mcp-users`, created by this module at startup when missing |
| OAuth scope | `mcp:tools` (plus `offline_access` for refresh tokens) |
| Log service | `tronrelic:mcp` |
| Scheduler jobs | None |
| Bootstrap order | Inits after `AiToolsModule` (needs the governor and registry) and identity (needs the verifier, grants, groups, and URLs); runs after both |

## Why This Is a Module

The endpoint needs raw Express requests (the MCP SDK reads Node request and response objects, and the body must not be parsed before authentication), a root URL (`/mcp`) rather than `/api/plugins/<id>/`, and constructor injection of the governor and the identity verifier. A module cannot be disabled, so the kill switch on `/system/mcp` stands in for a plugin's on/off switch.

## Source Map

| Path | Responsibility |
|---|---|
| `McpModule.ts` | Lifecycle; builds services in `init()`; in `run()` creates the group, registers the menu, mounts `/mcp`, the discovery documents, and the admin router |
| `api/mcp-endpoint.controller.ts` | The request pipeline (kill switch → Origin → method → token placement → bearer challenge → scope → membership → body parse → SDK) |
| `api/protected-resource-metadata.ts` | The RFC 9728 document |
| `api/mcp-admin.controller.ts`, `api/mcp-admin.routes.ts` | Admin API |
| `services/mcp-settings.store.ts` | Kill switch persistence with a 5-second in-memory cache |
| `services/mcp-tool-exposure.service.ts` | Approvals, capability fingerprints, and the served tool list |
| `services/capabilityFingerprint.ts` | SHA-256 over the governing capability fields |
| `services/mcp-caller.resolver.ts` | Token → verified caller, with scope and `mcp-users` membership checks and a 30-second principal cache; tells the identity module (`recordUse`) about each accepted request, which feeds the "Last used" column |
| `services/mcp-server.factory.ts` | Builds the per-request `McpServer`, maps tools and annotations, and routes each call through the governor |

## Request Pipeline

Every request to `/mcp` passes these checks in order. The first failure answers and stops.

| Step | Refusal |
|---|---|
| Kill switch off, or unreadable | `503` with `Retry-After` (3600 when off, 30 when the settings read fails) |
| Browser `Origin` not the site host | `403` (server-to-server clients send no `Origin`) |
| Method other than POST | `405`, `Allow: POST` |
| `access_token` in the query string | `400` |
| No bearer token | `401`, `WWW-Authenticate: Bearer resource_metadata="…", scope="mcp:tools offline_access"` — this is what starts a client's sign-in. Both scopes are listed here and in `scopes_supported` (`MCP_OAUTH_SCOPES`) so clients ask for a refresh token |
| Token fails verification, grant revoked, or account deleted | `401` with `error="invalid_token"` |
| Grant store or account directory unreadable | `503` with `Retry-After: 30` — never a `401`, which would make the client discard a token that may be valid |
| Token lacks `mcp:tools` | `403` with `error="insufficient_scope"` |
| User not in `mcp-users` | `403` |
| Body over 256 KB or not JSON | `413` / `400` |

The global Express body parsers skip `/mcp` (`loaders/express.ts`), so nothing is read from an anonymous request's body. After the checks, the served tool list is computed for this request, the caller and tools ride into the SDK on `req.auth.extra`, and `McpServerFactory` builds a server that registers only those tools.

**Token verification** is done by the identity module's `OAuthAccessTokenVerifier`, injected as `IMcpAccessTokenVerifier`. It checks the JWT locally against the signing keys (no HTTP), requires `typ: at+jwt`, the site issuer, and `aud` equal to the resource URL, refuses DPoP-bound tokens, and confirms the consent for `(user, client)` still exists and was created no later than the token's `iat` (cached 30 seconds), so reconnecting an app does not revive tokens issued before a revocation. A token issued for any other audience is refused.

## Tool Exposure

Every tool starts hidden. An admin approves each tool on the Tools tab. A tool is **served** only while it is enabled in the AI tool registry, passes the eligibility floor, is approved, and its capability still matches the fingerprint recorded at approval.

| Rule | Where enforced |
|---|---|
| Eligibility floor (`getMcpToolIneligibility`): capability declared, `sideEffect: 'read'`, reversible, not `secret`, not `spendsMoney` | Approval (`setExposure` refuses with 400), served list, and the policy engine on every `mcp` call |
| Approval invalidated when the capability changes (row shows *stale*) | Served list; re-approving accepts the new capability |
| Only served tools reachable | The server registers only served tools, and the governor enforces the same names as the call's `toolAllowlist` |
| A tool whose effective policy requires approval | Policy engine refuses it on `mcp` rather than parking it in the approval queue |

The floor exists because the user's AI client brings its own ways to send data off-site (web fetch, email), so the platform treats the exfiltration leg of the lethal trifecta as always present on this path and removes the private-data leg instead.

## Governor Integration

Each call becomes `governor.invoke(name, args, ctx)` with:

| Context field | Value |
|---|---|
| `triggerPath` | `'mcp'` — never treated as "an admin is present": curation auto-approve does not apply, and the external-tool default-deny does |
| `actor` | `{ kind: 'user', id: <userId> }` |
| `endUser` | The live principal (groups, email, primary wallet) from the account directory |
| `toolAllowlist` | The served tool names. An `mcp` call without one is denied |
| `quotaKey` | `mcp-user:<userId>` — the chain query tools send it to ClickHouse as the quota key, giving each user their own ClickHouse quota bucket. `queryId` is left unset, because an MCP call belongs to no run |
| `origin` | `{ clientId, credentialId: <jti>, ip }`, copied onto the audit record |
| `aiProviderId` | `'mcp'` |

On the `mcp` path the governor skips the untrusted-content screen (each screen is a paid model call and the caller controls the call rate) but keeps the `{ untrustedContentNotice, data }` wrapper. The policy engine adds per-user windows on top of the shared per-tool and global ones: 30 calls per tool per minute and 60 calls per minute across tools, per user. Results go back as JSON text plus `structuredContent`; refusals come back as `isError` results carrying the governor's reason. A tool that fails while running comes back as an `isError` result with a fixed message, because the governor's error for that case is the handler's raw exception text; the real message stays on the audit record. The server's `instructions` (returned by `server/discover`) carry `UNTRUSTED_CONTENT_SYSTEM_CLAUSE`, which clients may add to the model's system prompt.

Tool annotations are derived from the capability: `readOnlyHint` (read), `destructiveHint` (irreversible), `idempotentHint` (read), `openWorldHint` (external or surfaces untrusted content).

## Admin REST API

All under `/api/admin/mcp`. Changes that widen access need a signed-in admin (`req.adminVia === 'user'`); changes that narrow access also accept the `ADMIN_API_TOKEN` service path, so an operator can shut things down from a script.

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | `IMcpStatus`: settings, resource URL, issuer, group id, member count, served and stale tool counts |
| PUT | `/settings` | `{ enabled }`. Turning on requires a signed-in admin; turning off accepts the service token |
| GET | `/tools` | `IMcpToolExposure[]` for every registered tool, sorted by owning module or plugin (`provider`), then by name |
| PUT | `/tools/:name` | `{ exposed }`. Exposing requires a signed-in admin. 400 ineligible · 404 unknown |
| GET | `/apps` | Connected apps across all users (`limit` 1–200, `offset`) |
| DELETE | `/apps/:userId?clientId=` | Revoke one grant: consent, refresh tokens, and stored access tokens |

## Storage

| Collection | Shape | Indexes |
|---|---|---|
| `module_mcp_settings` | `{ _id: 'settings', enabled, updatedAt, updatedBy }` | — |
| `module_mcp_tool_approvals` | `{ toolName, fingerprint, approvedAt, approvedBy }` | unique `toolName` |

## Revocation Timing

| Action | Takes effect |
|---|---|
| Kill switch off | Within 5 seconds on every instance (settings cache) |
| Tool withdrawn | Next request on this instance, within 5 seconds on others (approvals cache) |
| App revoked (by user or admin) | Refresh tokens at once; access tokens on the next request on this instance, within 30 seconds on others (grant cache) |
| User removed from `mcp-users` | Within 30 seconds (principal cache). The identity module also revokes all of the user's connected apps, so adding them back later needs new consent |
| Access token expiry | 15 minutes |

## Deployment

Nginx must route `= /mcp` and `/.well-known/oauth-` to the backend (`tronrelic-ops/scripts/droplet-setup-nginx.sh` and `droplet-dev-up.sh` do, with a per-IP limit of 10 requests per second and a 1 MB body cap on `/mcp`). Next.js rewrites the same paths for local development. The resource URL and issuer derive from `BETTER_AUTH_URL`, falling back to `SITE_URL`; the URL users paste into their client must equal the resource URL exactly.

## Related

- [Identity Module README](../identity/README.md) — the OAuth authorization server, connected apps, and the consent page
- [AI Tools Module README](../ai-tools/README.md) — the governor pipeline and policy engine
- [system-ai-tools.md](../../../../docs/system/system-ai-tools.md) — the AI tool standard
- [modules-architecture.md](../../../../docs/system/modules/modules-architecture.md) — the module lifecycle and bootstrap order
