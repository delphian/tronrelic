# Tools Module

The tools module provides user-facing TRON blockchain utilities: address format conversion, energy estimation, bidirectional stake calculation, staking rewards by Super Representative, signature verification, token approval checking, and timestamp/block conversion. Each tool has its own page accessible from the "Tools" navigation menu.

## Why This Matters

TRON developers and users frequently need to convert address formats, estimate energy costs, calculate staking yields, verify signatures, audit token approvals, and look up block timestamps. Without a centralized tools section, these operations require external websites or manual API calls. The tools module consolidates these utilities into the TronRelic interface with live network data powering all calculations.

## Architecture Overview

The module follows TronRelic's two-phase lifecycle with dependency injection. The calculator service reads from the shared `transactions` collection for energy statistics and calls ChainParametersService for live network parameters. The address converter and signature verifier are stateless. The one thing the module stores and schedules is the [staking rewards snapshot](#staking-rewards-calculator): one collection, `module_tools_staking_rewards`, and one job, `tools:staking-rewards-refresh`.

Besides the shared dependencies, which include `hookRegistry` (`IHookRegistry`), used to declare the module's pages to the [sitemap](#sitemap-entries), `init()` receives `pageBootstrap` (`IPageBootstrapService`), the pages module's bootstrap service, which the [Bootstrap tab](#admin-page-and-bootstrap-pages) lists and creates the module's CMS pages through, `widgetsService` (`IWidgetsService`), used to register the [stake calculator widget](#stake-calculator-page) and the staking rewards widget, and an optional `scheduler` (`ISchedulerService | null`), which runs the staking rewards refresh. With no scheduler, including `ENABLE_SCHEDULER=false`, the snapshot is never refreshed.

**Backend** (`src/backend/modules/tools/`): ToolsModule implements IModule, creates services in `init()`, mounts routes and registers menu items in `run()`. Public routes are mounted at `/api/tools/*` and admin routes at `/api/admin/tools/*` via IoC.

**Frontend** (`src/frontend/modules/tools/`): Interactive client components for each tool. No SSR data fetching — tools are user-driven forms where loading states are appropriate for user-triggered API calls.

**Pages** (`src/frontend/app/[lang]/(site)/(core)/tools/`): Thin Next.js route wrappers importing from the tools module.

## Service Registry Dependencies

The module resolves two shared services from `IServiceRegistry` during `init()`:

| Registry Key | Service | Purpose |
|---|---|---|
| `chain-parameters` | `IChainParametersService` | Live `energyPerTrx`, `bandwidthPerTrx`, and `energyFee` ratios for stake and energy calculations, and the `blockRewardSun` and `voteRewardSun` reward rates for the staking rewards calculator |
| `blockchain` | `IBlockchainService` | The activation-ancestry climb behind the Address Origins tool, resolved per request rather than at init so boot order cannot leave a stale reference |

`chain-parameters` is required at init — `init()` throws if it is missing, causing application shutdown per the fail-fast convention. `blockchain` is resolved lazily and throws only if a request reaches the origins stream with no such service registered. The TronWeb instance used for signature verification and address normalization is not a registry service: `init()` builds it from `TronGridClient.createTronWeb()`.

## Available Tools

| Tool | URL | API Endpoint | Description |
|------|-----|-------------|-------------|
| Address Converter | `/tools/address-converter` | `POST /api/tools/address/convert` | Hex to base58check and reverse |
| Address Generator | `/tools/address-generator` | None; runs in the browser | New wallet with a recovery phrase, or a vanity address search; keys never leave the device |
| Energy Estimator | `/tools/energy-estimator` | `POST /api/tools/energy/estimate` | Daily energy needs, the stake that covers them, and the burn cost of not staking |
| Stake Calculator | `/tools/stake-calculator` | `POST /api/tools/stake/from-trx` and `/from-energy` | Bidirectional TRX/energy calculation |
| Staking Rewards | `/tools/staking-rewards` | `GET /api/tools/staking-rewards` | Yearly voting reward through each top-127 Super Representative, after commission |
| Signature Verifier | `/tools/signature-verifier` | `POST /api/tools/signature/verify` | Wallet signature verification |
| Approval Checker | `/tools/approval-checker` | `POST /api/tools/approval/check` | Scan TRC20 token approvals (requires login) |
| Address Origins | `/tools/address-origins` | `GET /api/tools/origins/stream` (SSE) | Trace a wallet's activation chain to its originator; multi-wallet + full ladder require login |
| Timestamp Converter | `/tools/timestamp-converter` | `POST /api/tools/timestamp/convert` | Bidirectional timestamp/block/date conversion |

### Energy Estimator Costs Are Burn Costs

The estimator prices its cost figures with the chain's `energyFee`, which is what the network burns in TRX for each unit of energy an account lacks (100 SUN today). That is not a rental price: energy rental markets usually charge a fraction of it, so calling the figure "rent" overstated renting several times over. The response therefore names the figures `burnPriceSun`, `burnCostPerDayTRX`, `burnCostPerMonthTRX`, and `burnMatchesStakeDays` (the days of burning that add up to the TRX staking would lock), and the page labels them as burn costs. Core holds no energy market data, so a rental price cannot be computed here without a contract that a market plugin publishes.

### Stake Calculator Page

The stake calculator's page text and search metadata are meant to be edited by admins without a deploy, so its address can be handed to a CMS page managed by the [pages module](../pages/README.md). An admin creates that page from the [Bootstrap tab](#admin-page-and-bootstrap-pages); nothing is created automatically.

| Part | Where | What it does |
|---|---|---|
| Widget type | `services/STAKE_CALCULATOR_WIDGET_TYPE.ts`, id `tools:stake-calculator` (`STAKE_CALCULATOR_WIDGET_TYPE_ID` in `@/types`) | Registered in `run()` through `IWidgetsService.registerType` with `tools` as the owner. Embeddable, takes no settings, and its fetcher returns `{}`. The frontend renders it with `StakeCalculatorWidget` from `components/widgets/widgets.core.ts` |
| Proposed page | `services/STAKE_CALCULATOR_PAGE_PROPOSAL.ts` | Every visible field matches the built-in page: the same title, description, and keywords, and a body with the same heading and intro line followed by the widget in a ` ```widget ` block, so approving the page changes no visible text. Its default address is `/tools/stake-calculator` (`STAKE_CALCULATOR_PATH` in `@/types`), and `source: 'tools-module'` is the actor a curator sees |
| Frontend route | `app/[lang]/(site)/(core)/tools/stake-calculator/page.tsx` | Serves the CMS page when it answers at this address, redirects when an admin has moved the page, and renders the built-in `StakeCalculator` page otherwise |

**The address is a default, not a fixture.** The page is created at `/tools/stake-calculator`, and from then on the CMS rules apply to it like any page. If an admin changes its slug, the pages module keeps the old address in the page's redirect history, and this route redirects visitors to the new one, the same as the catch-all route does for any renamed page.

**Why the route falls back.** A page is served in a language only while it has a published translation into that language, with no English fallback. When no CMS page answers here — before one is created or approved, after one is deleted, in every language the page has not been translated into, and when the backend cannot be reached — the built-in page keeps `/tools/stake-calculator` and its translated addresses answering. To move a translated address such as `/ru/tools/stake-calculator` onto the CMS page, publish that page's translation on `/system/pages`, and copy the ` ```widget ` block into the translated body unchanged.

## Staking Rewards Calculator

`/tools/staking-rewards` shows the yearly reward a voter earns through each of the top 127 Super Representatives (SRs), after the SR's commission, and applies the chosen SR's rate to a stake the visitor types. One staked TRX is one vote.

**Why it is stored, not computed per request.** Each SR's commission (TRON's "brokerage") is one `/wallet/getBrokerage` call, so a full computation is about 130 TronGrid requests on the queue block sync shares. The `tools:staking-rewards-refresh` job (`0 10 */6 * * *`) does it every six hours and stores the result; the page, the widget, and the endpoint only read the stored copy. `run()` also starts one refresh, not awaited, when nothing is stored yet, so a new deployment does not wait six hours. Concurrent refreshes share one run.

| Part | Where | What it does |
|---|---|---|
| Formula | `services/buildStakingRewardsSnapshot.ts` | Pure function. Vote reward per vote per year = `voteRewardSun` × blocks per year ÷ votes of the top 127, the same for each of them. Block reward for each of the top 27 = `blockRewardSun` × blocks per year ÷ 27 ÷ that SR's votes. Both × (1 − commission). The counts 127 and 27 are protocol constants, not chain parameters. Blocks per year come from `blockchainConfig.network.blockIntervalSeconds` |
| Service | `services/StakingRewardsService.ts` | Reads the reward rates from the `chain-parameters` service, votes from `/wallet/listwitnesses`, and each top-127 commission from `/wallet/getBrokerage`, one at a time through `TronGridClient`. Replaces the single document `{ _id: 'latest' }` in `module_tools_staking_rewards`. A missing reward rate throws and leaves the previous snapshot in place rather than guessing |
| Types | `IStakingRewardsSnapshot`, `ISuperRepresentativeReward`, `STAKING_REWARDS_PATH`, `STAKING_REWARDS_WIDGET_TYPE_ID`, `TOOLS_JOB_PREFIX` in `@/types` | Shared by the backend, the route, and the widget |
| Widget type | `services/createStakingRewardsWidgetType.ts`, id `tools:staking-rewards` | Embeddable, no settings. Its fetcher returns `{ snapshot }`, so a CMS page renders the table on the server. Frontend: `StakingRewardsWidget` in `widgets.core.ts` |
| Proposed page | `services/STAKING_REWARDS_PAGE_PROPOSAL.ts` | Same title, description, keywords, heading, and intro as the built-in page, then the widget. Offered on the Bootstrap tab |
| Frontend route | `app/[lang]/(site)/(core)/tools/staking-rewards/page.tsx` | Same CMS-or-built-in rule as the stake calculator. The built-in page reads the snapshot on the server (revalidated every five minutes) and passes it to `StakingRewards` |

The calculator works out per-year, per-month, and per-day TRX in the browser (`lib/estimateStakingReward.ts`) as simple interest, because rewards are claimed by hand at most once a day and only compound if re-staked. The block reward assumes each producer makes an equal share of blocks, so a producer that misses blocks pays slightly less than shown. Before the first refresh finishes, the page and the widget say the figures are being calculated.

## Admin Page and Bootstrap Pages

`/system/tools`, under the System container, has four tabs registered in the `tools-admin` menu namespace (`TOOLS_ADMIN_SUBMENU_NAMESPACE` in `@/types`): **Bootstrap**, **Schedules** (`SchedulerMonitor` filtered by `TOOLS_JOB_PREFIX`), **Database** (`CollectionBrowser` with prefix `module_tools_`), and **Logs** (`SystemLogsMonitor` scoped to `tronrelic:tools`). An admin runs the staking rewards refresh by hand from the Schedules tab.

The Bootstrap tab lists the CMS pages the module ships, from `services/TOOLS_BOOTSTRAP_PAGES.ts`, with the state of the address each would take and a **Create** button. `init()` binds that list with `pageBootstrap.createCatalog(...)`, and clicking Create proposes the page through the catalog, which calls `IPageService.proposePage`, the same path an AI tool uses, so it waits in `/system/curation` and nothing changes for visitors until a curator approves it. To offer another page, add an entry to that file. The tab draws the shared `PageBootstrapPanel` from `modules/pages`, which plugins get as `context.system.PageBootstrapPanel`; the state rules and refusal statuses are documented once, in [Page Bootstrap](../pages/README.md#page-bootstrap).

| Endpoint | Returns | Notes |
|---|---|---|
| `GET /api/admin/tools/bootstrap` | `{ success, pages: IToolsBootstrapPage[] }` | One row per offered page, with its `state` and the page holding the address, if any |
| `POST /api/admin/tools/bootstrap/:id` | `{ success, page, curationId }`, 201 | A refusal takes the status `PAGE_BOOTSTRAP_REFUSAL_STATUS` maps its reason to: 404 for an unknown entry, 409 when a page holds the address, 503 when curation is not running |

Both sit behind `createAdminRateLimiter('tools-admin')` and `requireAdmin`.

**When Create is offered.** A page is created only when no page holds its address at that moment, and the button can be used again whenever the address is free, however many times the page existed before. The catalog asks `IPageService.findPageHoldingSlug` (any review or deletion state, slug or redirect history) and reports one of the `PageBootstrapState` values. The pages module refuses a new page on any address another page holds, and it counts a soft-deleted page and a page whose proposal was rejected as holding theirs, because deletion is soft and there is no purge. So in the `rejected`, `deleted`, and `redirect` states the button is replaced by a note naming the holding page; the admin acts on that page in `/system/pages`. Two clicks racing past the check still create one page, because the pages module refuses the second.

The Signature Verifier supports direct URL linking via query parameters: `/tools/signature-verifier?wallet=T...&message=hello&signature=0x...` — it auto-fills and verifies on page load.

## Security

### Rate Limiting and Authentication

Endpoints are rate-limited at 30 requests per 60-second window per IP address, using the same Redis-backed `createRateLimiter` infrastructure as other public routes. All tools are unauthenticated except the approval checker, which is gated by the shared `requireLogin` middleware (`api/middleware/require-login.ts`) and has its own tighter limiter (10 requests per 60 seconds).

The origins stream has its own limiter too, at 6 requests per 60 seconds. It is the one endpoint whose cost is not bounded by its own request: a signed-in caller can ask for ten wallets climbed twenty hops, and each uncached hop is two or three throttled TronGrid calls on the queue live block sync shares. At the general 30-per-minute limit one caller could commission tens of thousands of provider calls and leave the block feed running behind.

### Async Error Handling

All route handlers are wrapped with `asyncHandler` so that thrown errors (Zod validation failures, service exceptions, TronGrid timeouts) reach the global error handler middleware instead of becoming unhandled promise rejections.

### Address Origins Streaming and Access Tiers

`GET /api/tools/origins/stream` is a Server-Sent Events endpoint (the tool's parents must appear as they resolve, not after the whole climb). It is intentionally public but **branches on the session**: an anonymous caller gets one address climbed a single hop (its immediate parent), while a valid session unlocks up to ten wallets climbed to the full depth cap, with ancestors shared across wallets highlighted. The gate is enforced server-side in `AddressOriginsService.resolvePlan` — the client cannot lift its own tier. The climb itself lives on the core blockchain service; the tool only adds the gating policy and the SSE plumbing. Wallets are climbed **round-robin** — the handler holds one `climbActivationAncestrySteps()` generator per wallet and advances each by a single hop per pass — so every ladder grows together instead of the tenth wallet sitting blank until the first nine finish. Cost is unchanged: the walk is one throttled provider call at a time either way, and every hop is paced as described under [Upwalk Pacing](#upwalk-pacing). All wallets share one per-request edge cache so converging ladders fetch a common tail once, and resolved edges are memoized in Redis by the blockchain service, so a wallet traced twice costs nothing the second time (see the [blockchain module README](../blockchain/README.md)).

### Upwalk Pacing

Each upward step of a ladder — one hop — occupies at least `ORIGINS_UPWALK_INTERVAL_MS` (2 seconds), set in `services/address-origins.service.ts`. Core already spaces individual TronGrid calls 200ms apart, but that spacing protects the provider from the process as a whole. This one stops a single origins request spending all of that allowance on itself while live block sync waits behind it. The interval applies to hops, not to calls: the two or three provider calls inside one hop still run at core's rate.

| Rule | Behaviour |
|---|---|
| Scope | One `CallPacer` per request, built by `AddressOriginsService.createUpwalkPacer()` and shared by every ladder in that request. Adding wallets lengthens the trace instead of multiplying its provider load. |
| Measurement | Start to start. The interval is measured from when a hop starts, and the wait happens after the hop's calls finish, so hops reach the client at an even cadence however long each one spent in the provider queue. A hop that already took longer than the interval is sent at once. |
| First hop | Not paced, so every ladder shows its first rung immediately. |
| Closing step | The final call, which reports how the climb ended rather than yielding a rung, is not paced. |
| Disconnect | The handler aborts the pacer's signal when the client closes, so a hop waiting out its interval stops waiting. |
| Cached hops | Paced like any other. The tool cannot see whether a hop came from the Redis edge cache, so a repeat trace takes as long as the first one. |

The pacer itself is `lib/CallPacer.ts`, a generic utility that knows nothing about blockchains. `climbSteps` wraps the core generator's `next()` in `pacer.run()` and decides per call whether to pad it.

### What Each Hop Publishes, and Why It Says So Much

A ladder of identical-looking rows invites the reader to treat every rung as the same kind of fact, and they are not. Each `hop` event therefore carries both parties of the activation (`activatorAddress`, `callerAddress`), which one the climb followed (`climbedAddress`), the account the hop explains (`subjectAddress`), any co-controllers of that account (`subjectControllers`), and a `caveats` list from `resolveHopCaveats`.

| Caveat | Meaning |
|---|---|
| `internal-transfer` | The activating value came out of a contract's balance — code, which owns nothing |
| `climbed-caller` | The rung is the signer of that contract call, followed because the contract leads only to its deployer |
| `caller-unresolved` | An internal activation whose signer could not be read, so the rung is the contract and everything above it is that contract's history |
| `creation-time-unverified` | The subject carries no creation stamp, so the attribution rests on the transaction type alone |

The UI draws each wallet's climb as a single chain: a continuous rule down the left, a numbered disc per rung, and the words "activated by" with the edge's own date printed on the rule between one account and the next. Each caveat code becomes a `<Badge>` whose explanation is reachable by pointer and by touch through `<Tooltip>`, and is also carried as visually hidden text so assistive technology reads it without a tab stop on every chip. The party the climb passed over is offered beneath the rung as "Trace the contract", and each co-controller as "Trace a controller".

Two surfaces carry the claims no per-rung chip can make. A **Common ground** panel names every account reached by more than one of the compared wallets, with how many reached it and how far up it sat in each — the finding the multi-wallet mode exists to produce, stated directly rather than left for the reader to spot. Beside it a standing **reading guide** is always on screen rather than behind a disclosure, because the conclusions it warns against are the ones a reader forms while the chains are still filling in: that activation is a fee payment rather than ownership, that a shared account is only as meaningful as it is rare, and that a chain which ends has run out of indexed history rather than reached an origin.

Convergence is the only thing the page spends `--color-primary` on. A shared account gets a filled disc on the rule and a tinted rung, so it is findable while scrolling several chains at once; every other signal on the results surface stays neutral or takes a status colour.

Frontend layout: `src/frontend/modules/tools/components/AddressOrigins/`, with the stream's own lifecycle in `src/frontend/modules/tools/hooks/useOriginTrace.ts`.

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

The module creates a "Tools" container node in the `main` namespace with child entries for each tool, taken from `TOOL_PAGES` in `services/TOOL_PAGES.ts`. Menu items use memory-only persistence (recreated on each boot). The container sets no URL; the menu derives `/tools` from its label, and that address serves the category landing page listing every tool. Children link to their respective `/tools/*` pages.

## Sitemap Entries

The module owns `/tools` and every tool page, so it declares them to the sitemap itself, through the `http.sitemapEntries` hook, rather than core listing them in `src/frontend/app/sitemap.ts`. In `run()` it registers a handler as `'core'` that appends one entry for `/tools` (priority 0.8) and one per tool page (priority 0.7), all `weekly` and without `lastModified`, since the pages record no modification time. `services/buildToolsSitemapEntries.ts` builds them from the same `TOOL_PAGES` list as the menu, so adding a tool to that list adds its menu entry and its sitemap entry together. Each `url` in the list must match a route folder under `src/frontend/app/[lang]/(site)/(core)/tools/`.

When a tool's address is also served by an approved CMS page, such as `/tools/stake-calculator` after an admin creates it from the Bootstrap tab, the sitemap lists that address once, from the CMS entry, because the sitemap adds CMS pages before hook entries and skips an address it has already listed.

## Module Lifecycle

**init() phase:** Stores injected dependencies, registers TransactionModel with the database service, resolves `IChainParametersService` from the service registry, builds a TronWeb instance from `TronGridClient`, creates the address, calculator, signature, approval, timestamp, address-origins, and staking rewards services, creates ToolsController, and binds `TOOLS_BOOTSTRAP_PAGES` with the injected `pageBootstrap` and creates `ToolsAdminController` over the resulting catalog. Does NOT mount routes or register menu items.

**run() phase:** Registers the Tools menu category and child items in the `main` namespace, the `/system/tools` entry under the System container, and the `tools-admin` tab row; registers the `http.sitemapEntries` handler that declares `/tools` and every tool page; mounts the tools router at `/api/tools` with rate limiting and async error handling and the admin router at `/api/admin/tools`; registers the `tools:stake-calculator` and `tools:staking-rewards` widget types on the injected `widgetsService`; and, when a scheduler is present, registers `tools:staking-rewards-refresh` with the module logger and starts a first refresh if nothing is stored.

## Further Reading

- [modules.md](../../../docs/system/modules/modules.md) - Module system overview
- [modules-creating.md](../../../docs/system/modules/modules-creating.md) - Module creation guide
- [tron.md](../../../docs/tron/tron.md) - TRON energy system and network parameters
- [tron-chain-parameters.md](../../../docs/tron/tron-chain-parameters.md) - ChainParametersService architecture
