# MCP Module

TronRelic's Model Context Protocol (MCP) endpoints. Anyone connects their AI client (Claude, ChatGPT, Claude Code, Cursor) to `https://<site>/mcp` and calls the tools granted to the virtual `anonymous` group without signing in. Calling a member tool makes the client ask them to sign in on the same connector ("lazy authentication"); every account joins `mcp-users`, and a signed-in member calls the tools granted to any of their user groups. `https://<site>/mcp/public` remains as an anonymous-only alias. Each group can carry its own protections (secret scrubbing, an IP allowlist), call limits, and an on/off switch, and a group other than `mcp-users` and `anonymous` can be cleared for restricted tools. The identity module is the OAuth 2.1 authorization server; this module is the protected resource. Every tool call runs through the AI tool governor under the `mcp` trigger path and is counted in the ClickHouse `mcp_calls` table, which the usage view on `/system/mcp` totals by group, tool, and caller.

## Agent Quick Surface

| Surface | Value |
|---|---|
| Module id | `mcp` |
| Module class | `src/backend/modules/mcp/McpModule.ts` |
| Endpoints | `POST /mcp` for members and anonymous callers on one URL, and `POST /mcp/public`, an anonymous-only alias that never asks for sign-in (stateless Streamable HTTP, MCP 2026-07-28; 2025-era clients served by the SDK's legacy path). Other methods answer `405`. See [One URL and Lazy Sign-In](#one-url-and-lazy-sign-in) |
| Discovery | `GET /.well-known/oauth-protected-resource/mcp` and `GET /.well-known/oauth-protected-resource` (RFC 9728), for `/mcp` only. The authorization server metadata at `/.well-known/oauth-authorization-server` is served by the identity module. For `/mcp/public`: the Server Card at `GET /mcp/public/server-card` and the AI Catalog at `GET /.well-known/ai-catalog.json`. See [Self-Description and Discovery](#self-description-and-discovery) |
| Public docs page | `/p/mcp`, a CMS page (pages module), linked from `llms.txt` |
| Admin page | `/system/mcp` (menu item `MCP`, order 46): kill switch above the tab row; tabs Overview (with the usage view) · Tools · Connected apps · Activity · Database · Logs |
| Admin API base | `/api/admin/mcp` (rate-limited + `requireAdmin`) |
| Types package | `@delphian/tronrelic-types` → `IMcpSettings`, `IMcpStatus`, `IMcpToolExposure`, `IMcpToolGrant`, `IMcpGroup`, `IMcpGroupPolicy`, `IMcpGroupPolicyPatch`, `IMcpGroupLimits`, `McpPrincipalKind`, `McpEndpointKind`, `McpUsageWindow`, `IMcpUsageFigures`, `IMcpUsageGroupRow`, `IMcpUsageToolRow`, `IMcpUsageCallerRow`, `IMcpUsageReport`, `IMcpUsageGroupDetail`, `mcpGroupMayHoldTool`, `normaliseIpAllowlistEntries`, `IMcpAccessTokenClaims`, `IMcpAccessTokenVerifier`, `IMcpClientAdmissionPolicy`, `IMcpClientDetails`, `MCP_TOOLS_SCOPE`, `MCP_OAUTH_SCOPES`, `MCP_USERS_GROUP_ID`, `MCP_ANONYMOUS_GROUP_ID`, `getMcpToolIneligibility`, `getMcpAnonymousToolIneligibility`, `IToolInvocationOrigin`, `IToolCallerBudget`, `ToolLimitKind` |
| Allowed apps | `MCP_ALLOWED_CLIENT_HOSTS` in `services/McpClientAdmissionPolicy.ts` (`claude.ai`). See [App Admission](#app-admission) |
| Owned collections | `module_mcp_settings` (one document: the kill switch), `module_mcp_tool_approvals` (one per tool and group), `module_mcp_group_policies` (one per configured group) |
| Owned ClickHouse table | `mcp_calls`, one row per call, 13-month expiry. See [Accounting](#accounting) |
| Migrations | `module:mcp:001_tool_approvals_group_id` — assigns approvals stored before per-group grants to `mcp-users` and drops the old unique `toolName` index; until it runs, those approvals are not served. `module:mcp:002_create_mcp_calls_table` — creates `mcp_calls`; until it runs, calls are not counted and the usage view says so. Both operator-run at `/system/database` |
| OAuth tables | Owned by identity: `module_user_auth_oauth_*`, `module_user_auth_jwks` |
| User groups | `mcp-users`, created by this module at startup when missing. `anonymous` is virtual: it has no record in the identity module, which refuses to create a real group with that id |
| OAuth scope | `mcp:tools` (plus `offline_access` for refresh tokens) |
| Log service | `tronrelic:mcp` |
| Scheduler jobs | None |
| Bootstrap order | Inits after `AiToolsModule` (needs the governor and registry) and identity (needs the verifier, grants, groups, account directory, and URLs); runs after both |
| Hooks | Registers `'core'` handlers on `http.groupDeleted` (removes the deleted group's grants and policy) and `ai.toolInvoked` (feeds the accounting meter) |

## Why This Is a Module

The endpoint needs raw Express requests (the MCP SDK reads Node request and response objects, and the body must not be parsed before authentication), a root URL (`/mcp`) rather than `/api/plugins/<id>/`, and constructor injection of the governor and the identity verifier. A module cannot be disabled, so the kill switch on `/system/mcp` stands in for a plugin's on/off switch.

## Source Map

| Path | Responsibility |
|---|---|
| `McpModule.ts` | Lifecycle; builds services in `init()`, including one endpoint controller per endpoint; in `run()` creates the group, registers the menu, registers both hook handlers, starts the meter, mounts `/mcp`, `/mcp/public`, the discovery documents, and the admin router |
| `api/mcp-endpoint.controller.ts` | The request pipeline both endpoints share (kill switch → Origin → method → token placement → authenticator → body parse → served tools → SDK) |
| `services/IMcpCaller.ts` | The admitted caller every later step reads: endpoint, principal kind and id, groups, and the end user for signed-in callers |
| `services/IMcpCallerAuthenticator.ts` | The contract for identifying a caller, and `McpAuthOutcome` (ok, challenge, refuse, unavailable) |
| `services/OAuthCallerAuthenticator.ts` | `/mcp`: bearer token → caller through the resolver; no token is a 401 challenge |
| `services/AnonymousCallerAuthenticator.ts` | `/mcp/public`: every request without credentials is an anonymous caller in `anonymous`; a request carrying `Authorization` is refused with 400 |
| `services/MemberOrAnonymousCallerAuthenticator.ts` | `/mcp`: a request with `Authorization` goes to the OAuth authenticator, one without is an anonymous caller |
| `services/AnonymousCallerKeyer.ts` | Salted hash of the caller's network range (/24 IPv4, /64 IPv6), the id anonymous limits count by |
| `services/readClientName.ts` | The cleaned, length-capped `User-Agent`, kept as an unverified client label |
| `services/IMcpCallMeter.ts`, `services/McpCallMeter.ts` | Buffers one accounting row per call and writes batches to `mcp_calls` |
| `services/McpUsageService.ts` | Totals `mcp_calls` for the usage view |
| `migrations/002_create_mcp_calls_table.ts` | Creates `mcp_calls` |
| `api/protected-resource-metadata.ts` | The RFC 9728 document |
| `api/server-card.ts` | The public endpoint's Server Card and the AI Catalog, with their CORS, caching, and ETag handling |
| `services/IMcpServerIdentity.ts`, `services/buildMcpServerIdentity.ts` | How the server describes itself (reverse-DNS name, title, version, description, site, icon, terms and privacy URLs), built once from the site origin and shared by the handshake and the Server Card |
| `api/mcp-admin.controller.ts`, `api/mcp-admin.routes.ts` | Admin API |
| `services/mcp-settings.store.ts` | Kill switch persistence with a 5-second in-memory cache |
| `services/mcp-tool-exposure.service.ts` | Per-group grants, capability fingerprints, the tool list served to one caller, which group each served tool is charged to (`chargedRoute`), and why a tool was withheld (`explainWithheld`) |
| `services/McpGroupPolicyService.ts` | Per-group settings and limits: storage with a 5-second cache, validation, the virtual `anonymous` group and its defaults, and `isWideningPolicyChange` |
| `services/IpAllowlistMatcher.ts` | Allowlist validation and matching over `net.BlockList` (IPv4, IPv6, CIDR, IPv4-mapped IPv6) |
| `services/SecretScrubber.ts` | Removes known secret values, credential patterns, and secret-named fields from a result |
| `services/capabilityFingerprint.ts` | SHA-256 over the governing capability fields |
| `migrations/001_tool_approvals_group_id.ts` | Backfills `groupId: 'mcp-users'` on pre-group approvals and drops the `toolName_1` index |
| `services/mcp-caller.resolver.ts` | Token → verified caller, with scope and `mcp-users` membership checks and a 30-second principal cache; drops `anonymous` from a member's groups; tells the identity module (`recordUse`) about each accepted request, which feeds the "Last used" column |
| `services/mcp-server.factory.ts` | Builds the per-request `McpServer`, maps tools and annotations, routes each call through the governor with the charged group's budget (`buildCallerBudget`) and origin, and scrubs results where a group asks for it |
| `services/McpClientAdmissionPolicy.ts` | `IMcpClientAdmissionPolicy`: which apps may register with the OAuth server, the refusal log and its limits, and the warning when a registered app changes its details |

## Request Pipeline

Both endpoints are one `McpEndpointController` class, built twice with a different authenticator (`IMcpCallerAuthenticator`). Every request passes these checks in order. The first failure answers and stops.

| Step | Refusal |
|---|---|
| Kill switch off, or unreadable | `503` with `Retry-After` (3600 when off, 30 when the settings read fails). Covers both endpoints |
| Browser `Origin` not the site host | `403` (server-to-server clients send no `Origin`) |
| Method other than POST | `405`, `Allow: POST` |
| `access_token` in the query string | `400` |
| Authenticator refuses | See the two tables below |
| Body over 256 KB or not JSON | `413` / `400` |

On `/mcp` (`MemberOrAnonymousCallerAuthenticator`), a request **without** an `Authorization` header is admitted as an anonymous caller exactly as on `/mcp/public`, with `endpoint: 'oauth'`. A request **with** one goes to `OAuthCallerAuthenticator`, and a bad token is never downgraded to anonymous, so the client refreshes or signs in again:

| Condition | Refusal |
|---|---|
| Anonymous call to a member tool | `401`, `WWW-Authenticate: Bearer error="invalid_token", resource_metadata="…", scope="mcp:tools offline_access"` — this is what starts a client's sign-in. See [One URL and Lazy Sign-In](#one-url-and-lazy-sign-in). Both scopes are listed here and in `scopes_supported` (`MCP_OAUTH_SCOPES`) so clients ask for a refresh token |
| Token fails verification, grant revoked, or account deleted | `401` with `error="invalid_token"` |
| Grant store or account directory unreadable | `503` with `Retry-After: 30` — never a `401`, which would make the client discard a token that may be valid |
| Token lacks `mcp:tools` | `403` with `error="insufficient_scope"` |
| User not in `mcp-users` | `403` |

On `/mcp/public` (`AnonymousCallerAuthenticator`) there is never a challenge, because a `401` from that URL would point at sign-in metadata describing `/mcp`, and Claude requires the two to match exactly. A request carrying an `Authorization` header is refused with `400` naming `/mcp`, because a client that sends credentials expects them to count. Every other request is admitted as an anonymous caller: principal kind `anonymous`, groups `['anonymous']`, no end user, and a principal id from `AnonymousCallerKeyer`.

The global Express body parsers skip both paths (`loaders/express.ts`), so nothing is read from an unadmitted request's body. After the checks, the served tool list is computed for this caller from their groups and request address, the caller and tools ride into the SDK on `req.auth.extra`, and `McpServerFactory` builds a server that registers only those tools.

A `tools/call` for a tool that was not served gets the SDK's bare "Tool not found" answer. Before handing the request over, the endpoint writes a log entry under `tronrelic:mcp` (`error` for a member, `warn` for an anonymous caller, where strangers probing for tools is expected traffic) naming the tool, the caller, the client, the request address, the caller's groups, and a `reason` from `explainWithheld`: `not-registered`, `disabled`, `not-granted`, `stale-grant`, `restricted-not-allowed`, `not-public`, `group-disabled`, or `ip-not-allowed` (`changed-during-request` when a grant changed between the two reads). It also counts the refusal in `mcp_calls`. At most 10 per request.

## One URL and Lazy Sign-In

Claude and ChatGPT both design for one URL where anonymous tools work at once and sign-in is asked for only when a tool needs an account (Claude's connector docs call it lazy authentication; OpenAI declares `noauth` and `oauth2` per tool). `/mcp` follows that model:

| Step | What happens |
|---|---|
| Connect and `tools/list` without a token | Admitted as anonymous. Listed: the tools served to `anonymous`, plus every tool a member of `mcp-users` would be served from that address (`signInGroupId` on the controller), marked `requiresSignIn` and prefixed in their description with a note that calling them asks the user to sign in |
| `tools/call` for a `requiresSignIn` tool | Answered before the SDK with the `401` above, because a tool result always travels in a `200` and Claude ignores a sign-in request on a `200`. Counted in `mcp_calls` with reason `sign-in-required` and logged at `info`; charged to no limit, because no tool ran |
| User signs in | The client shows its Connect card, the user signs in or creates an account on `/oauth/authorize`, and the client retries the same call with a token. New accounts join `mcp-users` automatically (identity module, `joinMcpUsers` in `auth.ts`), so the consent step and token check let them through |
| Later requests | Carry the token; the caller is a member and gets their groups' tools and limits |

Restricted tools can never be granted to `mcp-users`, so they can never appear in the anonymous list. A `requiresSignIn` tool is left out of the governor's allowlist, and its handler only returns a "sign in" error, so it cannot run for an anonymous caller even if the `401` step were skipped. A failure to read the member tools is logged at `warn` and leaves the anonymous tools working.

New members are no longer asked to sign in when they add the connector: the first request succeeds anonymously, and sign-in happens the first time the model calls a member tool. Claude Code users can sign in by hand with `/mcp`.

`/mcp/public` predates the merge and stays as an anonymous-only alias for clients that were given it. The MCP specification makes authorization optional, so both are within it.

## The Anonymous Group

`anonymous` (`MCP_ANONYMOUS_GROUP_ID`) is a virtual group. It has no members and no record in the identity module, which refuses to create a real group with that id because grants and policies are stored by group id alone. `McpGroupPolicyService.listGroups` adds it beside the real groups, so it appears on the Tools tab and grants and limits are set for it the same way as for any group. A real group created under that id before the reservation has no MCP effect (the caller resolver drops it from members' groups, and the admin page lists only the virtual group) and startup logs a warning naming it.

| Rule for `anonymous` | Where enforced |
|---|---|
| Only tools passing `getMcpAnonymousToolIneligibility` (the MCP floor plus `sensitivity: 'public'` and not `operatesOnUserOwnedObjects`) may be granted or served. No setting waives it | Grant (400), served list (`not-public`), and the governor's policy engine on every anonymous call |
| Never allowed restricted tools | Policy validation (400), `mcpGroupMayHoldTool`, `toPolicy` |
| Every limit must be set; starts at 30 calls a minute per caller, 500 per 24 hours per caller, 5,000 per 24 hours for the group (`DEFAULT_ANONYMOUS_LIMITS`). A caller is a network range, and Anthropic's servers carry every claude.ai user from about two dozen /24 ranges, so the per-caller limits are generous; they stay well below the pool so one scraper on one network cannot empty it and lock every anonymous caller out for the day, which is also why major public servers (Exa, Context7) keep per-IP limits on keyless use. Callers who need more sign in | Policy validation (400); a stored document missing a limit reads as the default |
| A caller is one network range: a /24 for IPv4, a /64 for IPv6 | `AnonymousCallerKeyer`. Counting single addresses would let a caller with an IPv6 allocation rotate past every limit |
| The id is a salted SHA-256 of the range, cut to 16 hex characters; callers with no readable address share the id `unknown` | The salt is `TRAFFIC_IP_HASH_SALT`, falling back to `SESSION_SECRET` (the traffic module's salt), passed in as `anonymousKeySalt` |

## Limits and the Group Switch

Each group's `IMcpGroupPolicy` carries `enabled` and `limits` (`IMcpGroupLimits`). Switching a group off stops serving every tool it grants (`group-disabled`) while keeping its grants and settings. Every real group starts switched on with no limits of its own (`null`), so the platform ceilings alone apply.

| Limit | Counted per | Platform behaviour |
|---|---|---|
| `callsPerMinutePerCaller` | Caller, across every tool and group the caller reaches | At most 60, the governor's own ceiling, which applies whatever a group says. `null` means 60 |
| `callsPerDayPerCaller` | Caller and group, over a fixed 24-hour window from the first call | `null` means no daily cap |
| `callsPerDayGroup` | The whole group, every caller together | `null` means no pooled cap. This is the ceiling that bounds what a group can cost |

The governor also holds every caller to 30 calls a minute per tool. Day windows are fixed 24-hour windows started by the first call, not calendar days.

**Charging a call to a group.** A member reaches a tool through every group of theirs that grants it. The call is charged to exactly one of them, and that group's limits apply: the most generous route, meaning the highest per-caller day limit (no limit counts highest), then the highest per-minute limit, then the group id alphabetically (`chargedRoute`). Charging the strictest route instead would make a premium group pointless, because every member is also in `mcp-users`. The charged group's id travels on the audit record as `origin.chargedGroupId` and on the accounting row as `charged_group`.

`buildCallerBudget` turns the charged group's limits into the `IToolCallerBudget` the governor enforces: minute windows keyed by caller alone (`mcp:<kind>:<id>`), the day window keyed by caller and group, and the pool keyed by group (`mcp-pool:<group>`). The governor charges the minute windows, then the day window, then the pool, each only when the call fit the one before, so a caller hammering past a minute limit never spends their day budget or the group's pool. A refusal by a limit is recorded with `limitHit` naming it. See the [AI Tools Module README](../ai-tools/README.md#the-mcp-trigger-path).

## Accounting

Every MCP call becomes one row in the ClickHouse `mcp_calls` table. Calls the governor handled are counted from its audit record through the `ai.toolInvoked` hook, so the accounting rows and the audit trail cannot disagree. Calls refused before the governor (a tool that was not served) are counted by the endpoint controller. `McpCallMeter` buffers rows and writes them in batches every 5 seconds or at 500 rows; a failed write is logged at `warn` and its rows dropped, because accounting must never slow down or break a tool call, and the MongoDB audit trail still holds every call. Without ClickHouse nothing is counted and the usage view says so.

| Column | Contents |
|---|---|
| `timestamp` | When the call was recorded (`DateTime64(3, 'UTC')`) |
| `endpoint` | `oauth` or `public` |
| `principal_kind`, `principal_id` | `user` with a Better Auth user id, or `anonymous` with the hashed network id. No raw address is stored |
| `charged_group` | The group whose limits applied. A refused not-served call is counted against `anonymous` for anonymous callers and `mcp-users` for members |
| `tool` | The tool called |
| `outcome` | `succeeded`, `refused`, or `failed` |
| `status`, `limit_hit`, `reason` | The governor's status (or `not-served`), the limit that refused the call, and why a tool was not served |
| `duration_ms`, `cost_usd` | Run time and recorded cost |
| `client_id`, `client_name`, `record_id` | The OAuth client, the self-reported `User-Agent` (a label, never an identity), and the audit record id |

Ordered by `(charged_group, timestamp)`, partitioned by month, and expired after 13 months.

**The usage view.** The Overview tab of `/system/mcp` shows endpoint totals and one row per group for a 24-hour, 7-day, or 30-day window, with each group's pool use over the last 24 hours. Opening a group shows its tools and busiest callers; choosing a tool narrows the callers to that tool; opening a caller shows their individual calls from the governor's audit feed, filtered by `chargedGroupId` and `principalId`. `mcp-users` and `anonymous` always appear, even with no calls.

## Future: API Keys

API keys are not built. They are the planned middle tier between anonymous callers and OAuth members: a key issued to an account, sent to `/mcp/public`, and charged to that account's groups, so a script or agent can be held to a member's limits without an interactive sign-in. Every piece of this module is shaped so adding them changes nothing else.

| Piece | What adding API keys needs |
|---|---|
| `McpPrincipalKind` | Add `'api-key'` |
| Authentication | A new `ApiKeyCallerAuthenticator` implementing `IMcpCallerAuthenticator`, reading a key header such as `x-api-key`, and a small composite authenticator on `/mcp/public` that tries it first and falls back to `AnonymousCallerAuthenticator`. The public authenticator's refusal of an `Authorization` header is then narrowed to headers the key authenticator does not accept |
| Caller | The key authenticator produces an `IMcpCaller` with `principalKind: 'api-key'`, `principalId` set to the key id, `groups` from the owning account, and `endUser` set to the owner, so `operatesOnUserOwnedObjects` tools scope to them |
| Limits and charging | None. Grants, `chargedRoute`, `buildCallerBudget`, and the governor's budget all work from groups and principal ids already |
| Accounting | None. `principal_kind` is a string column, so `api-key` rows need no schema change; the usage view labels them by key id |
| Still to build | Key storage (hashed, with owner, label, created and last-used times, and revocation), the issuing and revoking interface on `/system/mcp` and in the member's profile, and whether keys inherit every owner group or a chosen subset |

Keys are kept out of the OAuth token path on purpose: the MCP authorization specification says a server must not accept tokens its authorization server did not issue, so a key travels in its own header rather than as a bearer token.

**Token verification** is done by the identity module's `OAuthAccessTokenVerifier`, injected as `IMcpAccessTokenVerifier`. It checks the JWT locally against the signing keys (no HTTP), requires `typ: at+jwt`, the site issuer, and `aud` equal to the resource URL, refuses DPoP-bound tokens, and confirms the consent for `(user, client)` still exists and was created no later than the token's `iat` (cached 30 seconds), so reconnecting an app does not revive tokens issued before a revocation. A token issued for any other audience is refused.

## App Admission

An app (Claude, Claude Code) identifies itself to the OAuth server with the HTTPS address of a JSON document it publishes, and the server fetches that document and stores a client row for it. The standard lets any address do this, so on 11 Nov 2026 a scanner registered an app of its own by pointing the server at a document it hosted. `McpClientAdmissionPolicy` closes that: an address is accepted only when it is HTTPS on the default port, carries no user name or password, and its host is in `MCP_ALLOWED_CLIENT_HOSTS`. The host is compared exactly and after parsing, so neither `sub.claude.ai` nor `claude.ai.example.com` passes.

The identity module calls the policy, because it builds the OAuth server, and it starts before this module. The bootstrap therefore constructs the policy and passes it to `IdentityModule.init()` as `oauthClientAdmission`. The policy belongs to this module because the OAuth server exists only for MCP, and because its entries must be written under `tronrelic:mcp` to appear on this module's Logs tab.

A refused app is never fetched and no row is stored for it. The OAuth library runs the check before every fetch of an app's document and keeps fetched documents only in memory, so a row stored before the rule existed is refused on its first use after a restart.

**To admit another app**, open the Logs tab of `/system/mcp`, find the `OAuth app refused` entry written when the app tried to connect, confirm the host belongs to the app's vendor, and add that host to `MCP_ALLOWED_CLIENT_HOSTS`. There is no public registry of these addresses, so the refusal entry is the reliable source. An app that only supports Dynamic Client Registration cannot connect at all, because the identity module keeps that switched off.

| Log entry (`warn`, under `tronrelic:mcp`) | Fields | Written when |
|---|---|---|
| `OAuth app refused: its address is not on the allowed list` | `callerSuppliedHost`, `callerSuppliedAddress`, `addressTruncated` | An address is refused |
| `OAuth app refused: the address it supplied could not be read` | `suppliedLength` | The text is not a URL |
| `OAuth app refusals are no longer being logged this window: the limit on distinct addresses was reached` | `loggedAddresses`, `windowMinutes` | The ceiling below is reached, once per window |
| `Connected app changed its name or redirect addresses` | `clientId`, `nameChanged`, `redirectsChanged`, and the name and redirect addresses before and after | A registered app's document is re-read and differs |

**The refused address is written by the caller**, who also decides how many requests to send, so the refusal log is bounded on both counts.

| Limit | Value | Constant |
|---|---|---|
| Entries per address | One per hour | `REFUSAL_LOG_WINDOW_MS` |
| Distinct addresses logged | 50 per hour, then one entry saying the ceiling was reached | `REFUSAL_LOG_MAX_ADDRESSES` |
| Logged address length | 300 characters | `REFUSAL_LOG_MAX_ADDRESS_LENGTH` |
| Logged parts | Scheme, host, and path only. The query string, fragment, user name, and password are dropped | `describeAddress` |

The logged address comes from the URL parser, which lowercases the host and percent-encodes spaces, control characters, and non-ASCII characters, so it is printable ASCII. That bounds its form and not its meaning: ordinary letters can still spell a sentence, so treat both `callerSupplied` fields as untrusted wherever they are displayed or handed to an AI model. The counters are per process, so two backend instances each log a refused address once.

A changed name or redirect address is logged and nothing is revoked. Only an app on an allowed host reaches that point, so the change is the vendor editing its own document, and revoking would disconnect every user of that app each time.

## Tool Exposure

Every tool starts hidden. On the Tools tab an admin picks a user group (or the virtual `anonymous` group) and grants tools to it; each grant is one document in `module_mcp_tool_approvals`. For signed-in callers on `/mcp`, `mcp-users` stays the only way in (every account joins it): a grant to another group reaches members of that group who are also in `mcp-users`. For anonymous callers on either URL, only `anonymous` grants run; `mcp-users` grants are listed to them on `/mcp` as needing sign-in. A caller is **served** a tool when at least one of their groups holds a grant for it that passes every check below.

| Rule | Where enforced |
|---|---|
| Tool enabled in the AI tool registry | Served list; the governor's enabled-check |
| Capability matches the fingerprint recorded at the grant (otherwise *stale*) | Served list; granting again accepts the new capability |
| Safety floor (`getMcpToolIneligibility`): capability declared, `sideEffect: 'read'`, reversible, not `secret`, not `spendsMoney`. A tool failing it is **restricted** | Grant (`setExposure` refuses with 400), served list, and the policy engine on every `mcp` call |
| A restricted tool may be granted only to a group whose policy has `allowRestrictedTools`, never to `mcp-users` or `anonymous` | Grant (400), policy validation (400), served list; the governor waives its floor only for names in `ctx.mcpRestrictedTools` that are also in `ctx.toolAllowlist` |
| A grant to `anonymous` must pass the anonymous floor | Grant (400), served list (`not-public`), and the governor on every anonymous call |
| The granting group is switched on | Served list (`group-disabled`) |
| Group IP allowlist, when on: the request address must match. A client may reach the site over IPv4 on one request and IPv6 on the next, so list both families, and list an IPv6 address as its `/64`, because the last half changes for privacy | Served list (per grant, so another group's grant without an allowlist still serves) |
| Only served tools reachable | The server registers only served tools, and the governor enforces the same names as the call's `toolAllowlist` |
| A tool whose effective policy requires approval | Policy engine refuses it on `mcp` rather than parking it in the approval queue, restricted or not |
| An `external` tool | The governor's autonomous default-deny applies on `mcp` unless an admin policy override grants `allowUnattended` |

The floor exists because the user's AI client brings its own ways to send data off-site (web fetch, email), so the platform treats the exfiltration leg of the lethal trifecta as always present on this path and removes the private-data leg instead. Allowing restricted tools for a group puts that leg back for its members; the per-group protections below reduce that risk and do not remove it.

## Group Protections

Each group has an `IMcpGroupPolicy`, stored in `module_mcp_group_policies` and edited on the Tools tab. Every protection starts off, the group starts switched on, and its limits start at the defaults in [Limits and the Group Switch](#limits-and-the-group-switch); a group with no stored policy behaves exactly so.

| Setting | Effect | Applies to |
|---|---|---|
| `scrubSecrets` | Successful results pass through `SecretScrubber` before they are written to the client: exact matches of the deployment's secret values (from `config/collectDeploymentSecrets.ts`, values of 12+ characters), credential patterns (PEM private keys, JWTs, `user:password@` in URLs, Bearer/Basic values, `sk-`, `ghp_`, `xox`, `AKIA`, `re_` keys, Telegram bot tokens), and string fields named like `password`, `apiKey`, `botToken`, `webhookSecret`, `authorization` | A tool, when any group serving it to this caller has it on |
| `ipAllowlistEnabled` + `ipAllowlist` | The group's grants serve only to requests whose address (`req.ip`, IPv4-mapped IPv6 unwrapped) matches an entry. Up to 100 addresses or CIDR ranges; cannot be switched on while empty | Each of the group's grants on its own |
| `allowRestrictedTools` | Lets the group be granted restricted tools. Never true for `mcp-users` or `anonymous`. Switching it off withdraws every restricted grant the group holds (`withdrawRestrictedGrants`), and the served list ignores them at once | The group's restricted grants |
| `enabled` | Off stops serving every tool the group grants, keeping its grants and settings. Switching off asks for confirmation on the page | The group's grants |
| `limits` | Calls per minute and per 24 hours per caller, and per 24 hours for the whole group, for calls charged to the group. See [Limits and the Group Switch](#limits-and-the-group-switch) | Calls charged to the group |

Scrubbing cannot recognise a secret it has never seen that matches no pattern, and cannot tell a TRON private key from a transaction hash. The admin page asks for confirmation before allowing restricted tools and before withdrawing them.

**Deleting a group removes its grants and policy.** Group ids are reusable slugs, and grants and policies are keyed by group id alone, so anything left behind would apply to a new group created under the same id with nobody approving it, including `allowRestrictedTools`. The identity module fires the `http.groupDeleted` hook after a deletion, and this module's handler calls `withdrawGroupGrants` and `deleteForGroup`. The hook is an observer, so a failed cleanup is logged and does not fail the deletion; the stranded documents are then listed as unserved grants on the Tools tab and can be withdrawn by hand.

## Governor Integration

Each call becomes `governor.invoke(name, args, ctx)` with:

| Context field | Value |
|---|---|
| `triggerPath` | `'mcp'` — never treated as "an admin is present": curation auto-approve does not apply, and the external-tool default-deny does |
| `actor` | `{ kind: 'user', id: <userId> }`, or `{ kind: 'anonymous', id: <network hash> }` on `/mcp/public` |
| `endUser` | The live principal (groups, email, primary wallet) from the account directory; absent for an anonymous caller |
| `toolAllowlist` | The served tool names. An `mcp` call without one is denied |
| `mcpRestrictedTools` | The restricted tools among them, served through a group that allows restricted tools; omitted when there are none |
| `callerBudget` | The charged group's limits as an `IToolCallerBudget` (`buildCallerBudget`) |
| `quotaKey` | `mcp-user:<userId>` or `mcp-anon:<network hash>` — the chain query tools send it to ClickHouse as the quota key, giving each caller their own ClickHouse quota bucket. `queryId` is left unset, because an MCP call belongs to no run |
| `origin` | `{ endpoint, principalKind, principalId, chargedGroupId, clientId, clientName, credentialId: <jti>, ip }`, copied onto the audit record |
| `aiProviderId` | `'mcp'` |

On the `mcp` path the governor skips the untrusted-content screen (each screen is a paid model call and the caller controls the call rate) but keeps the `{ untrustedContentNotice, data }` wrapper. The policy engine charges the caller's budget before the shared per-tool and global windows, and MCP calls count in their own shared windows, separate from the ones admin, scheduled, and programmatic runs use, so outside traffic cannot lock the platform's own AI runs out of a tool. Results go back as JSON text plus `structuredContent`; refusals come back as `isError` results carrying the governor's reason. A tool that fails while running comes back as an `isError` result with a fixed message, because the governor's error for that case is the handler's raw exception text; the real message stays on the audit record. The server's `instructions` (returned by `server/discover`) end with `UNTRUSTED_CONTENT_SYSTEM_CLAUSE`, which clients may add to the model's system prompt; see [Self-Description and Discovery](#self-description-and-discovery) for what else they say.

Tool annotations are derived from the capability: `readOnlyHint` (read), `destructiveHint` (irreversible), `idempotentHint` (read), `openWorldHint` (external or surfaces untrusted content).

## Self-Description and Discovery

Clients show a server's handshake details in their connector lists, and registries and crawlers read a Server Card before connecting. `buildMcpServerIdentity` builds one `IMcpServerIdentity` from the public endpoint's origin at startup, and both places read it, so they cannot disagree. Nothing in it names a domain, because one image serves several.

| Field | Value | Where it appears |
|---|---|---|
| `name` | Reverse-DNS of the site host plus `/mcp` (`com.tronrelic/mcp`) | Server Card. The handshake keeps the short `serverInfo.name` `tronrelic`, which clients already store |
| `title`, `version` | `TronRelic`, `MCP_SERVER_VERSION` | Handshake and card. Bump the version when the served surface changes shape |
| `description` | One sentence, at most 100 characters (the card's limit; startup throws past it). Names what `anonymous` is granted, so change it when those grants change in kind | Handshake and card |
| `websiteUrl` | The site origin | Handshake and card |
| `icons` | `<origin>/icon.png`, the 192-pixel PNG Next.js serves from `app/icon.png` | Handshake and card |
| `termsUrl`, `privacyUrl` | `<origin>/terms`, `<origin>/privacy` | Public instructions |

**Instructions differ by caller.** A signed-in member gets one line about TronRelic's tools. An anonymous caller is told that the tools working without an account only read, to quote the capture time of any price because rental prices move during the day, to wait after a limit refusal rather than retry at once, and that use is subject to the terms and privacy policy; on `/mcp` they are also told that tools marked as needing an account ask the user to sign in, which also raises their limits. All end with `UNTRUSTED_CONTENT_SYSTEM_CLAUSE`.

**Server Card.** `GET /mcp/public/server-card`. SEP-2127 (final October 2026) recommends `<endpoint>/server-card` but allows any unreserved URI; the card stays at the address already published in `llms.txt` and the catalog. It carries `$schema`, the identity fields above, and one `streamable-http` remote at **`/mcp`**, the one URL for anonymous callers and members, whose `supportedProtocolVersions` are `2026-07-28` followed by the SDK's `SUPPORTED_PROTOCOL_VERSIONS`. Tools are deliberately not listed; the extension leaves them to `tools/list`.

**AI Catalog.** `GET /.well-known/ai-catalog.json` lists the card under `urn:air:<host>:mcp:public`, so a crawler that knows only the domain can find it.

| Behaviour | Both documents |
|---|---|
| Media type | `application/mcp-server-card+json`, `application/ai-catalog+json` |
| CORS | `Access-Control-Allow-Origin: *`, `GET`, request headers `Content-Type, If-None-Match`, exposed `ETag`. The global CORS middleware skips both paths (`skipForPublicDiscovery` in `loaders/express.ts`), because it refuses every browser origin but the site's own |
| Caching | `Cache-Control: public, max-age=3600`, a strong `ETag` computed once, `304` for a matching `If-None-Match` |
| Methods | `GET` and `HEAD`; `OPTIONS` answers the preflight with `204`; anything else `405` with `Allow` |

The paths are `MCP_SERVER_CARD_PATH` and `AI_CATALOG_PATH` in the identity module's `oauth-server-config.ts`, beside the endpoint paths they derive from; the bootstrap passes their URLs in as `serverCardUrl` and `aiCatalogUrl`.

## Admin REST API

All under `/api/admin/mcp`. Changes that widen access need a signed-in admin (`req.adminVia === 'user'`); changes that narrow access also accept the `ADMIN_API_TOKEN` service path, so an operator can shut things down from a script.

| Method | Path | Purpose |
|---|---|---|
| GET | `/status` | `IMcpStatus`: settings, resource URL, public URL, issuer, group id, member count, served and stale tool counts |
| PUT | `/settings` | `{ enabled }`. Turning on requires a signed-in admin; turning off accepts the service token |
| GET | `/usage?window=24h\|7d\|30d` | `{ usage: IMcpUsageReport }`: endpoint totals and one row per group. `available: false` with a reason when ClickHouse is not configured or `mcp_calls` does not exist. 400 unknown window |
| GET | `/usage/groups/:groupId?window=&tool=` | `{ detail: IMcpUsageGroupDetail }`: the group's tools and busiest callers (at most 100 each); `tool` narrows the callers. 400 · 404 unknown group |
| GET | `/tools` | `IMcpToolExposure[]` for every registered tool, each with its `grants` per group, sorted by owning module or plugin (`provider`), then by name |
| PUT | `/tools/:name` | `{ exposed, groupId? }`, `groupId` defaulting to `mcp-users`. Granting requires a signed-in admin. 400 restricted and the group may not hold it · 404 unknown tool or group · 409 the old unique `toolName` index refused the grant because `module:mcp:001_tool_approvals_group_id` has not run, or "allow restricted tools" was switched off while a restricted grant was being written (the grant is removed again) |
| GET | `/groups` | `IMcpGroup[]`: every user group with its policy, `mcp-users` first, then the virtual `anonymous` group |
| PUT | `/groups/:groupId/policy` | Any of `{ allowRestrictedTools, scrubSecrets, ipAllowlistEnabled, ipAllowlist, enabled, limits }`; within `limits` an omitted limit is kept and `null` clears it. A widening change (`isWideningPolicyChange`: allowing restricted tools, turning scrubbing or the allowlist off, adding an address, switching the group on, raising or clearing a limit) requires a signed-in admin. Answers `{ policy, withdrawnRestrictedGrants }`. 400 invalid · 403 · 404 unknown group · 409 another admin changed one of these settings after this change was previewed, so it was refused rather than overwriting the newer value |
| GET | `/apps` | Connected apps across all users (`limit` 1–200, `offset`) |
| DELETE | `/apps/:userId?clientId=` | Revoke one grant: consent, refresh tokens, and stored access tokens |

## Storage

| Collection | Shape | Indexes |
|---|---|---|
| `module_mcp_settings` | `{ _id: 'settings', enabled, updatedAt, updatedBy }` | — |
| `module_mcp_tool_approvals` | `{ toolName, groupId, fingerprint, restricted, approvedAt, approvedBy }`. `restricted` records whether the tool failed the safety floor when granted, so `withdrawRestrictedGrants` still removes the grant while its tool is unregistered. A document without `groupId` predates per-group grants and is ignored until the migration runs | unique `{ toolName, groupId }` |
| `module_mcp_group_policies` | `{ groupId, allowRestrictedTools, scrubSecrets, ipAllowlistEnabled, ipAllowlist, enabled, limits, updatedAt, updatedBy }`. Documents written before `enabled` and `limits` existed read as switched on with the group's default limits, and are given those values on their next change | unique `groupId` |

## Revocation Timing

| Action | Takes effect |
|---|---|
| Kill switch off | Within 5 seconds on every instance (settings cache) |
| Tool withdrawn | Next request on this instance, within 5 seconds on others (approvals cache) |
| Group protection, switch, or limit changed | Next request on this instance, within 5 seconds on others (policies cache). A lowered day limit applies to the current window's count at once |
| User removed from a granting group other than `mcp-users` | Within 30 seconds (principal cache) |
| App revoked (by user or admin) | Refresh tokens at once; access tokens on the next request on this instance, within 30 seconds on others (grant cache) |
| User removed from `mcp-users` | Within 30 seconds (principal cache). The identity module also revokes all of the user's connected apps, so adding them back later needs new consent |
| Access token expiry | 15 minutes |

## Deployment

Nginx must route `= /mcp`, `= /mcp/public`, `= /mcp/public/server-card`, `= /.well-known/ai-catalog.json`, and `/.well-known/oauth-` to the backend (`tronrelic-ops/scripts/droplet-setup-nginx.sh` and `droplet-dev-up.sh` do, with a per-IP limit of 10 requests per second on the MCP paths and a 1 MB body cap on both endpoints). Next.js rewrites the same paths for local development. The resource URL, public URL, and issuer derive from `BETTER_AUTH_URL`, falling back to `SITE_URL`; the URL users paste into their client must equal the resource URL exactly.

To open the public endpoint: run `module:mcp:002_create_mcp_calls_table` from `/system/database` so calls are counted, grant one or more `public` tools to Anonymous on the Tools tab, review its limits, and share the public URL from the Overview tab or the `/p/mcp` docs page. Nothing is served there until a tool is granted.

## Related

- [Identity Module README](../identity/README.md) — the OAuth authorization server, connected apps, and the consent page
- [AI Tools Module README](../ai-tools/README.md) — the governor pipeline and policy engine
- [system-ai-tools.md](../../../../docs/system/system-ai-tools.md) — the AI tool standard
- [modules-architecture.md](../../../../docs/system/modules/modules-architecture.md) — the module lifecycle and bootstrap order
