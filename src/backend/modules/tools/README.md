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
| `tronweb` | `TronWeb` | Configured TronWeb instance for signature verification and address normalization |

Both are required — `init()` throws if either is missing, causing application shutdown per the fail-fast convention.

## Available Tools

| Tool | URL | API Endpoint | Description |
|------|-----|-------------|-------------|
| Address Converter | `/tools/address-converter` | `POST /api/tools/address/convert` | Hex to base58check and reverse |
| Energy Estimator | `/tools/energy-estimator` | `POST /api/tools/energy/estimate` | Daily energy needs with staking vs rental cost comparison |
| Stake Calculator | `/tools/stake-calculator` | `POST /api/tools/stake/from-trx` and `/from-energy` | Bidirectional TRX/energy calculation |
| Signature Verifier | `/tools/signature-verifier` | `POST /api/tools/signature/verify` | Wallet signature verification |
| Approval Checker | `/tools/approval-checker` | `POST /api/tools/approval/check` | Scan TRC20 token approvals for a wallet |
| Timestamp Converter | `/tools/timestamp-converter` | `POST /api/tools/timestamp/convert` | Bidirectional timestamp/block/date conversion |

The Signature Verifier supports direct URL linking via query parameters: `/tools/signature-verifier?wallet=T...&message=hello&signature=0x...` — it auto-fills and verifies on page load.

## Security

### Rate Limiting

All endpoints are unauthenticated and rate-limited at 30 requests per 60-second window per IP address, using the same Redis-backed `createRateLimiter` infrastructure as other public routes.

### Async Error Handling

All route handlers are wrapped with `asyncHandler` so that thrown errors (Zod validation failures, service exceptions, TronGrid timeouts) reach the global error handler middleware instead of becoming unhandled promise rejections.

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

**init() phase:** Stores injected dependencies, registers TransactionModel with the database service, resolves `IChainParametersService` and `TronWeb` from the service registry, creates CalculatorService and SignatureService, creates ToolsController. Does NOT mount routes or register menu items.

**run() phase:** Registers the Tools menu category and child items in the `main` namespace, mounts the tools router at `/api/tools` with rate limiting and async error handling.

## Further Reading

- [modules.md](../../../docs/system/modules/modules.md) - Module system overview
- [modules-creating.md](../../../docs/system/modules/modules-creating.md) - Module creation guide
- [tron.md](../../../docs/tron/tron.md) - TRON energy system and network parameters
- [tron-chain-parameters.md](../../../docs/tron/tron-chain-parameters.md) - ChainParametersService architecture
