# Tools Module

The tools module provides user-facing TRON blockchain utilities: address format conversion, energy estimation, bidirectional stake calculation, signature verification, token approval checking, and timestamp/block conversion. Each tool has its own page accessible from the "Tools" navigation menu.

## Why This Matters

TRON developers and users frequently need to convert address formats, estimate energy costs, calculate staking yields, verify signatures, audit token approvals, and look up block timestamps. Without a centralized tools section, these operations require external websites or manual API calls. The tools module consolidates these utilities into the TronRelic interface with live network data powering all calculations.

## Architecture Overview

The module follows TronRelic's two-phase lifecycle with dependency injection. It has no database collections of its own — the calculator service reads from the shared `transactions` collection for energy statistics and calls ChainParametersService for live network parameters. The address converter and signature verifier are stateless.

**Backend** (`src/backend/modules/tools/`): ToolsModule implements IModule, creates services in `init()`, mounts routes and registers menu items in `run()`. Routes are mounted at `/api/tools/*` via IoC.

**Frontend** (`src/frontend/modules/tools/`): Interactive client components for each tool. No SSR data fetching — tools are user-driven forms where loading states are appropriate for user-triggered API calls.

**Pages** (`src/frontend/app/(core)/tools/`): Thin Next.js route wrappers importing from the tools module.

## Service Registry Dependencies

The module resolves two shared services from `IServiceRegistry` during `init()`:

| Registry Key | Service | Purpose |
|---|---|---|
| `chain-parameters` | `IChainParametersService` | Live `energyPerTrx`, `bandwidthPerTrx`, and `energyFee` ratios for stake and energy calculations |
| `blockchain` | `IBlockchainService` | The activation-ancestry climb behind the Address Origins tool, resolved per request rather than at init so boot order cannot leave a stale reference |

`chain-parameters` is required at init — `init()` throws if it is missing, causing application shutdown per the fail-fast convention. `blockchain` is resolved lazily and throws only if a request reaches the origins stream with no such service registered. The TronWeb instance used for signature verification and address normalization is not a registry service: `init()` builds it from `TronGridClient.createTronWeb()`.

## Available Tools

| Tool | URL | API Endpoint | Description |
|------|-----|-------------|-------------|
| Address Converter | `/tools/address-converter` | `POST /api/tools/address/convert` | Hex to base58check and reverse |
| Energy Estimator | `/tools/energy-estimator` | `POST /api/tools/energy/estimate` | Daily energy needs with staking vs rental cost comparison |
| Stake Calculator | `/tools/stake-calculator` | `POST /api/tools/stake/from-trx` and `/from-energy` | Bidirectional TRX/energy calculation |
| Signature Verifier | `/tools/signature-verifier` | `POST /api/tools/signature/verify` | Wallet signature verification |
| Approval Checker | `/tools/approval-checker` | `POST /api/tools/approval/check` | Scan TRC20 token approvals (requires login) |
| Address Origins | `/tools/address-origins` | `GET /api/tools/origins/stream` (SSE) | Trace a wallet's activation chain to its originator; multi-wallet + full ladder require login |
| Timestamp Converter | `/tools/timestamp-converter` | `POST /api/tools/timestamp/convert` | Bidirectional timestamp/block/date conversion |

The Signature Verifier supports direct URL linking via query parameters: `/tools/signature-verifier?wallet=T...&message=hello&signature=0x...` — it auto-fills and verifies on page load.

## Security

### Rate Limiting and Authentication

Endpoints are rate-limited at 30 requests per 60-second window per IP address, using the same Redis-backed `createRateLimiter` infrastructure as other public routes. All tools are unauthenticated except the approval checker, which is gated by the shared `requireLogin` middleware (`api/middleware/require-login.ts`) and has its own tighter limiter (10 requests per 60 seconds).

The origins stream has its own limiter too, at 6 requests per 60 seconds. It is the one endpoint whose cost is not bounded by its own request: a signed-in caller can ask for ten wallets climbed twenty hops, and each uncached hop is two or three throttled TronGrid calls on the queue live block sync shares. At the general 30-per-minute limit one caller could commission tens of thousands of provider calls and leave the block feed running behind.

### Async Error Handling

All route handlers are wrapped with `asyncHandler` so that thrown errors (Zod validation failures, service exceptions, TronGrid timeouts) reach the global error handler middleware instead of becoming unhandled promise rejections.

### Address Origins Streaming and Access Tiers

`GET /api/tools/origins/stream` is a Server-Sent Events endpoint (the tool's parents must appear as they resolve, not after the whole climb). It is intentionally public but **branches on the session**: an anonymous caller gets one address climbed a single hop (its immediate parent), while a valid session unlocks up to ten wallets climbed to the full depth cap, with ancestors shared across wallets highlighted. The gate is enforced server-side in `AddressOriginsService.resolvePlan` — the client cannot lift its own tier. The climb itself lives on the core blockchain service; the tool only adds the gating policy and the SSE plumbing. Wallets are climbed **round-robin** — the handler holds one `climbActivationAncestrySteps()` generator per wallet and advances each by a single hop per pass — so every ladder grows together instead of the tenth wallet sitting blank until the first nine finish. Cost is unchanged: the walk is one throttled provider call at a time either way. All wallets share one per-request edge cache so converging ladders fetch a common tail once, and resolved edges are memoized in Redis by the blockchain service, so a wallet traced twice costs nothing the second time (see the [blockchain module README](../blockchain/README.md)).

### What Each Hop Publishes, and Why It Says So Much

A ladder of identical-looking rows invites the reader to treat every rung as the same kind of fact, and they are not. Each `hop` event therefore carries both parties of the activation (`activatorAddress`, `callerAddress`), which one the climb followed (`climbedAddress`), the account the hop explains (`subjectAddress`), any co-controllers of that account (`subjectControllers`), and a `caveats` list from `resolveHopCaveats`.

| Caveat | Meaning |
|---|---|
| `internal-transfer` | The activating value came out of a contract's balance — code, which owns nothing |
| `climbed-caller` | The rung is the signer of that contract call, followed because the contract leads only to its deployer |
| `caller-unresolved` | An internal activation whose signer could not be read, so the rung is the contract and everything above it is that contract's history |
| `creation-time-unverified` | The subject carries no creation stamp, so the attribution rests on the transaction type alone |

The UI turns each code into a chip plus the sentence explaining it, renders the party the climb passed over as a "trace contract" lead, offers each co-controller as a "trace controller" lead, and carries a standing reading guide covering the claims no per-hop chip can make: that activation is a fee payment rather than ownership, that a shared ancestor is only as meaningful as it is rare, and that a chain which ends has run out of indexed history rather than reached an origin.

The handler sets `Cache-Control: no-transform` to opt out of the global `compression()` middleware (which would otherwise buffer events), writes an SSE comment every 20 seconds so a proxy cannot time out a climb that is waiting on a deep provider queue, and owns its own error handling for every write including the opening `start` event — once the stream opens the response is committed, so an error that escaped to the global middleware would try to rewrite a response that already has a status and a body.

### Input Validation

The controller validates all inputs with Zod schemas before reaching service code. Upper bounds prevent overflow in arithmetic operations and cache key pollution.

| Field | Type | Bounds |
|---|---|---|
| `contractType` | string | 1-100 characters |
| `averageMethodCalls` | integer | 1-10,000 |
| `expectedTransactionsPerDay` | integer | 1-1,000,000 |
| `trx` | number | 1-100,000,000,000 |
| `energy` | number | 1-100,000,000,000 |
| `wallet` | string | min 34 characters |
| `message` | string | min 1 character |
| `signature` | string | min 1 character |
| `address` (approval) | string | 34-42 characters |
| `timestamp` | integer | 0-32,503,680,000 (optional) |
| `blockNumber` | integer | 1-999,999,999,999 (optional) |
| `dateString` | string | max 100 characters (optional) |

### Cache Key Sanitization

The `contractType` value flows into a Redis cache key for energy stats aggregation. Before interpolation, the value is stripped of non-alphanumeric characters (except hyphens and underscores) and truncated to 100 characters to prevent cache namespace pollution.

## Menu Registration

The module creates a "Tools" container node in the `main` namespace with child entries for each tool. Menu items use memory-only persistence (recreated on each boot). The container has no URL (category-only), while children link to their respective `/tools/*` pages.

## Module Lifecycle

**init() phase:** Stores injected dependencies, registers TransactionModel with the database service, resolves `IChainParametersService` from the service registry, builds a TronWeb instance from `TronGridClient`, creates the address, calculator, signature, approval, timestamp, and address-origins services, and creates ToolsController. Does NOT mount routes or register menu items.

**run() phase:** Registers the Tools menu category and child items in the `main` namespace, mounts the tools router at `/api/tools` with rate limiting and async error handling.

## Further Reading

- [modules.md](../../../docs/system/modules/modules.md) - Module system overview
- [modules-creating.md](../../../docs/system/modules/modules-creating.md) - Module creation guide
- [tron.md](../../../docs/tron/tron.md) - TRON energy system and network parameters
- [tron-chain-parameters.md](../../../docs/tron/tron-chain-parameters.md) - ChainParametersService architecture
