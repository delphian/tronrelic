# Market Fetcher Discovery Guide

When you find a new TRON energy market on the web, this guide walks you through discovering its API, modeling its data in TypeScript, and integrating it into TronRelic's normalized pricing system.

## Why This Matters

Adding markets without proper discovery leads to broken integrations, incorrect pricing calculations, and unreliable data. The risks include:

- **Missing duration fields** cause energy regeneration calculations to fail, showing 7-30x inflated costs for multi-day rentals
- **Misinterpreting price units** (total vs per-unit) breaks the entire normalization pipeline
- **Skipping verification** means bad data reaches production and misleads users
- **Poor interface design** makes maintenance difficult when APIs change

This systematic approach ensures every new market integrates correctly the first time and remains maintainable long-term.

## How It Works

Discovery follows five stages, each building on the previous:

1. **API Discovery** - Locate the market's data endpoints using network analysis and common patterns
2. **Data Structure Analysis** - Understand the API response format and identify critical pricing fields
3. **Interface Design** - Create TypeScript types that match the API and document field meanings
4. **Transformation Logic** - Map API data to `MarketSnapshot` format with correct duration and price normalization
5. **Verification** - Test the complete pipeline from fetcher to frontend display

See [market-system-architecture.md](./market-system-architecture.md) for how the normalization system processes raw market data after discovery.

## Discovery Workflow

Follow these five stages to integrate a new market. Total time: 2-4 hours for a straightforward API, up to 8 hours for complex or undocumented markets.

### Step 1: API Discovery (15-60 minutes)

Find the market's data endpoints. Start with network traffic inspection, then check JavaScript bundles, then try common API paths. If those fail, use automated browser inspection with Playwright.

**Method 1: Network Traffic (Fastest)**

Open the market's website with browser DevTools and watch the Network tab for XHR/Fetch requests returning JSON. Look for responses containing pricing, energy availability, or duration fields.

**Method 2: JavaScript Bundles**

If network inspection fails, download the site's main JavaScript bundle and search for API endpoint patterns: `/api/`, `fetch(`, `axios.get(`. Most markets hardcode their endpoints in client code.

**Method 3: Common Paths**

Test standard REST patterns: `/api/v1/markets`, `/api/v1/pricing`, `/api/v1/energy`, `/api/markets/summary`.

**Method 4: Playwright Automated Inspection (For SPA/Dynamic Sites)**

Modern single-page applications (React, Vue, Angular) often return skeleton HTML to `curl` because pricing data loads dynamically via JavaScript. Without seeing the rendered page, you'll miss API endpoints that only fire after page load. Playwright solves this by running a real browser and capturing all network traffic.

**When to use this method:**
- `curl` returns minimal HTML with no pricing data
- Pricing renders dynamically via JavaScript
- Methods 1-3 found no obvious API endpoints
- You need to verify what data is actually visible to users

**Note:** Playwright is already installed as a local npm package in this project. No additional installation required.

```javascript
const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();

  const apiCalls = [];

  // Capture all responses that might be API endpoints
  // Check URL patterns (api, resources) and content type (JSON)
  page.on('response', async response => {
    const url = response.url();
    const contentType = response.headers()['content-type'];

    // Filter for API-like responses to reduce noise
    if (url.includes('api') || url.includes('resources') || contentType?.includes('json')) {
      try {
        const body = await response.text();
        apiCalls.push({ url, status: response.status(), body });
        console.log(`\n=== API: ${url} ===`);
        console.log(body.substring(0, 1000)); // First 1KB only to avoid flooding console
      } catch (e) {
        // Response body may be unavailable for redirects or errors
      }
    }
  });

  // Load the page and wait for all network activity to settle
  await page.goto('https://target-market.xyz/price', { waitUntil: 'networkidle' });

  // Additional wait ensures delayed API calls complete (e.g., setTimeout-based fetches)
  await page.waitForTimeout(3000);

  // Extract rendered page content to verify what users actually see
  const content = await page.evaluate(() => document.body.innerText);
  console.log('\n=== PAGE CONTENT ===');
  console.log(content.substring(0, 2000)); // First 2KB of visible text

  await browser.close();
})();
```

**Running the script:**

Save the code as `playwright-scraper.js` in the project root and run:

```bash
node playwright-scraper.js
```

Playwright runs via the locally installed npm package (`node_modules/.bin/playwright`). The `require('playwright')` statement automatically resolves to the local installation—no global install or special configuration needed.

**Real example: tronlending.xyz**

`curl` returned only skeleton HTML with no pricing data. Running the Playwright script revealed:
- Price table hardcoded in JavaScript (no pricing API exists)
- `/rent` page calls `https://axs.renttronenergy.com/price/rate` for dynamic pricing
- Transaction history API: `https://api.renttronenergy.com/transaction/get_transaction`

**Key insight:** Without Playwright, we would have assumed tronlending.xyz had no API at all. The automated inspection uncovered two separate API domains that weren't discoverable via `curl` or static JavaScript analysis.

**Time estimate:**
- Network inspection: 5-10 minutes (if API is obvious)
- JavaScript bundle analysis: 15-30 minutes (if endpoints are embedded)
- Playwright automation: 30-60 minutes (including script setup and analysis)

### Step 2: Data Structure Analysis (20-40 minutes)

Fetch the raw API response and identify critical fields for pricing, availability, and constraints.

**Essential fields to find:**

- **Pricing tiers** with duration and price (e.g., `[{period: 3, price: 60}]`)
- **Energy availability** (total capacity and currently available)
- **Order limits** (minimum and maximum energy amounts)
- **Duration units** (hours, days, or custom periods)

**Real example (itrx.io):**

```bash
curl https://itrx.io/api/v1/frontend/index-data | python3 -m json.tool
```

The response contained:
- `tiered_pricing: [{period: 0, price: 40}, {period: 1, price: 90}, {period: 3, price: 60}, {period: 30, price: 55}]`
- `platform_total_energy: 178873143` and `platform_avail_energy: 6575862`
- `minimum_order_energy: 12000` and `maximum_order_energy: 200000000`

**Critical discovery:** The `period` field used ambiguous numbers (0, 1, 3, 30). Checking the website UI confirmed these represent durations (immediate, 1 hour, 3 days, 30 days), not just arbitrary IDs.

**Time estimate:**
- Simple REST API: 10-15 minutes
- Complex or undocumented API: 30-40 minutes (including manual testing and field validation)

### Step 3: Interface Design (15-30 minutes)

Model the API response in TypeScript with JSDoc comments explaining field meanings. Use optional fields (`?`) for data that might be absent.

**Critical guidelines:**

- **Document field business meaning**, not just types (e.g., "Period identifier: 0=immediate, 1=1h, 3=3d, 30=30d")
- **Specify units** in comments (SUN, minutes, energy units)
- **Make optional** any field that could be null or missing

**Minimal example:**

```typescript
/**
 * Market data from itrx.io API
 */
interface TronEnergySummaryResponse {
    /** Total platform energy capacity */
    platform_total_energy: number;

    /** Currently available energy */
    platform_avail_energy: number;

    /** Pricing tiers: period (0=1h, 1=1h, 3=3d, 30=30d), price (SUN per unit) */
    tiered_pricing?: Array<{
        period: number;
        price: number;
    }>;

    /** Fallback price in SUN */
    default_price?: number;

    minimum_order_energy?: number;
    maximum_order_energy?: number;
}
```

See the full implementation in [tron-energy.fetcher.ts](/apps/backend/src/modules/markets/fetchers/implementations/tron-energy.fetcher.ts) for the complete interface with all optional fields.

**Time estimate:**
- Straightforward API: 10-15 minutes
- Complex nested structures: 20-30 minutes (including validation and edge case handling)

### Step 4: Transformation Logic (30-60 minutes)

Map the API response to `MarketSnapshot` format. The critical part is building the `fees` array with correct duration and price values.

**The `fees` array drives everything:**

Each fee object requires:
- `minutes` - Duration in minutes (REQUIRED for energy regeneration calculations)
- `sun` - Price per unit of energy (REQUIRED for cost normalization)
- `energyAmount` - Reference bundle size (OPTIONAL, metadata only)

**Why `minutes` is critical:** TronRelic's calculator divides total rental cost by the number of 24-hour regeneration cycles. Without duration, the system cannot account for energy regeneration, and multi-day rentals will show 7-30x inflated costs.

**Real example (itrx.io period conversion):**

```typescript
// API returns periods as numbers (0, 1, 3, 30)
// Must convert to minutes for regeneration calculations
const periodToMinutes = (period: number): number => {
    switch (period) {
        case 0: return 60;              // Immediate = 1 hour
        case 1: return 60;              // 1 hour
        case 3: return 60 * 24 * 3;     // 3 days
        case 30: return 60 * 24 * 30;   // 30 days
        default: return period * 60 * 24; // Assume days if unknown
    }
};

const fees = summary.tiered_pricing.map(tier => ({
    minutes: periodToMinutes(tier.period),
    sun: tier.price
}));
```

**Complete transformation pattern:**

```typescript
async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    const response = await context.http.get<TronEnergySummaryResponse>(endpoint);
    const data = response.data;

    return {
        guid: this.guid,
        name: this.name,
        priority: 100,
        energy: {
            total: data.platform_total_energy ?? 0,
            available: data.platform_avail_energy ?? 0,
            minOrder: data.minimum_order_energy ?? 32_000,
            maxOrder: data.maximum_order_energy
        },
        fees: data.tiered_pricing?.map(tier => ({
            minutes: periodToMinutes(tier.period),
            sun: tier.price
        })),
        isActive: true
    };
}
```

See [tron-energy.fetcher.ts](/apps/backend/src/modules/markets/fetchers/implementations/tron-energy.fetcher.ts) for the complete implementation including address deduplication and metadata storage.

**Time estimate:**
- Simple transformation: 20-30 minutes (including period conversion and basic mapping)
- Complex logic: 45-60 minutes (including unit conversions, conditional fields, and error handling)

### Step 5: Verification (30-60 minutes)

Confirm the complete pipeline works: type checking, build, data fetching, normalization, and frontend display.

**Quick verification checklist:**

```bash
# 1. Type check
npm run typecheck --workspace apps/backend

# 2. Build and restart
npm run build --workspace apps/backend && ./scripts/stop.sh && ./scripts/start.sh

# 3. Wait for scheduler run (check logs)
tail -f .run/backend.log | grep -i "market"

# 4. Verify fees array populated
curl -s http://localhost:4000/api/markets | python3 -m json.tool | grep -A 10 '"guid": "your-market"'

# 5. Verify pricing detail computed
curl -s http://localhost:4000/api/markets | python3 -c "
import sys, json
data = json.load(sys.stdin)
market = [m for m in data['markets'] if m['guid'] == 'your-market'][0]
print('Fees:', market.get('fees'))
print('Min cost:', market.get('pricingDetail', {}).get('minUsdtTransferCost'))
"
```

**Expected results:**

- `fees` array contains duration (`minutes`) and price (`sun`) values
- `pricingDetail.usdtTransferCosts` shows costs for each duration
- `minUsdtTransferCost` shows the cheapest option (usually longest duration)
- Frontend leaderboard displays the market with correct pricing

**Common failures:**

- **Empty `fees` array** - Check TypeScript interface matches API response structure
- **Missing `pricingDetail`** - Verify `minutes` field is a number, not null or string
- **Incorrect costs** - Ensure `sun` is per-unit price, not total bundle price

## Testing Guidance

### Unit Testing Individual Fetchers

Test your fetcher implementation in isolation before integration:

```typescript
// tests/market-fetchers/my-market.test.ts
import { describe, it, expect, vi } from 'vitest';
import { MyMarketFetcher } from '../../src/modules/markets/fetchers/implementations/my-market.fetcher.js';
import type { MarketFetcherContext } from '../../src/modules/markets/fetchers/types.js';

describe('MyMarketFetcher', () => {
    it('transforms API response to MarketSnapshot format', async () => {
        const mockContext: MarketFetcherContext = {
            http: {
                get: vi.fn().mockResolvedValue({
                    data: {
                        totalEnergy: 1_000_000,
                        availableEnergy: 500_000,
                        pricing: [
                            { durationMinutes: 60, pricePerUnit: 57, bundleSize: 1_000_000 }
                        ]
                    }
                })
            } as any,
            logger: console as any,
            cacheTtlSeconds: 600,
            chainParameters: null
        };

        const fetcher = new MyMarketFetcher();
        const snapshot = await fetcher.pull(mockContext);

        expect(snapshot).toMatchObject({
            guid: 'my-market',
            name: 'My Market',
            energy: {
                total: 1_000_000,
                available: 500_000
            },
            fees: [
                {
                    minutes: 60,
                    sun: 57,
                    energyAmount: 1_000_000
                }
            ]
        });
    });

    it('handles API errors gracefully', async () => {
        const mockContext: MarketFetcherContext = {
            http: {
                get: vi.fn().mockRejectedValue(new Error('Network timeout'))
            } as any,
            logger: console as any,
            cacheTtlSeconds: 600,
            chainParameters: null
        };

        const fetcher = new MyMarketFetcher();
        const snapshot = await fetcher.pull(mockContext);

        expect(snapshot).toBeNull();
    });
});
```

**Run unit tests:**
```bash
npm run test --workspace apps/backend
```

### Integration Testing with Live APIs

Test against real upstream APIs in a staging environment:

```bash
# Start backend in development mode
./scripts/start.sh

# Tail logs to monitor fetcher execution
tail -f .run/backend.log | grep -i "my-market"

# Wait for scheduled fetch (up to 10 minutes)
# Or manually trigger via admin API
curl -X POST http://localhost:4000/api/admin/markets/my-market/refresh \
  -H "x-admin-token: your-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'

# Verify market data in API response
curl -s http://localhost:4000/api/markets | jq '.markets[] | select(.guid == "my-market")'
```

### End-to-End Testing with Frontend

Verify the complete flow from fetcher to user interface:

1. **Start all services:**
   ```bash
   ./scripts/start.sh
   ```

2. **Navigate to markets page:**
   Open http://localhost:3000/markets in browser

3. **Verify market appears in leaderboard:**
   - Market name displays correctly
   - "TRX per USDT TX" shows numeric value (not "N/A")
   - Price range shows lowest and highest costs with durations
   - Availability percentage displays
   - "Updated" timestamp is recent (< 10 minutes old)

4. **Expand row details:**
   - USDT Transfer Cost section shows costs for each duration
   - Platform Pricing section shows normalized prices (if applicable)
   - All prices are reasonable (not negative, infinite, or suspiciously high)

5. **Test data refresh:**
   - Wait 10 minutes for next scheduled fetch
   - Verify "Updated" timestamp changes
   - Confirm pricing updates if upstream API changed

### Regression Testing

Compare new fetcher output against expected baselines:

```bash
# Capture baseline snapshot
curl -s http://localhost:4000/api/markets | jq '.markets[] | select(.guid == "my-market")' > baseline-my-market.json

# Make code changes and rebuild
npm run build --workspace apps/backend
./scripts/stop.sh && ./scripts/start.sh

# Wait for fetch cycle and capture new snapshot
sleep 600
curl -s http://localhost:4000/api/markets | jq '.markets[] | select(.guid == "my-market")' > current-my-market.json

# Compare snapshots (ignoring timestamp fields)
diff <(jq 'del(.lastUpdated)' baseline-my-market.json) <(jq 'del(.lastUpdated)' current-my-market.json)
```

### Testing Checklist

Before submitting a new market fetcher, verify:

- [ ] Unit tests pass for both success and error cases
- [ ] Fetcher handles API timeouts and network errors gracefully
- [ ] TypeScript compilation succeeds without errors
- [ ] Market appears in `/api/markets` endpoint
- [ ] `pricingDetail.minUsdtTransferCost` is populated with reasonable value
- [ ] Frontend leaderboard displays market correctly
- [ ] Expandable row details show pricing breakdowns
- [ ] `minutes` field is present in all fee objects
- [ ] `sun` field represents per-unit price (not total bundle price)
- [ ] Energy regeneration is accounted for in multi-day pricing
- [ ] Logs show successful fetcher execution without errors
- [ ] Market data updates every 10 minutes as scheduled

## Common Pitfalls

### Missing Duration Field

If the API doesn't provide duration, check the website UI or documentation to infer the standard rental period (most markets default to 1 hour or 1 day).

```typescript
fees.push({
    minutes: 60 * 24,  // Assume 1 day if not specified
    sun: item.price / item.energy
});
```

### Total Price vs Per-Unit Price

APIs often return total bundle prices (e.g., 57M SUN for 1M energy). Always convert to per-unit pricing:

```typescript
const sunPerUnit = totalPrice / energyAmount;  // 57M / 1M = 57 SUN per unit
fees.push({ minutes, sun: sunPerUnit });
```

If `sun` contains the total bundle price instead of per-unit, calculations will be off by orders of magnitude.

### Hardcoded USDT Energy Costs

**NEVER hardcode USDT transfer energy costs (e.g., 65,000 energy).** The actual energy cost varies based on the smart contract implementation and network state.

**Problem:**
Many markets price their energy bundles based on "1 USDT transfer" without specifying the exact energy amount. Developers often hardcode `65_000` or `65000` as the energy cost, but this is **inaccurate** (actual cost is ~64,285 as measured from blockchain).

**Solution:**
Use the `UsdtParametersService` to get real-time energy costs fetched from the blockchain every 10 minutes:

```typescript
import { UsdtParametersService } from '../../../usdt-parameters/usdt-parameters.service.js';

const usdtService = new UsdtParametersService();

async pull(context: MarketFetcherContext): Promise<MarketSnapshot | null> {
    // Fetch dynamic USDT energy cost instead of hardcoding 65_000
    const energyPerTransaction = await usdtService.getStandardTransferEnergy();

    // Convert API pricing (e.g., "2.5 TRX per USDT transfer") to per-unit pricing
    const fees = [{
        minutes: 60,
        sun: (apiPriceInTrx * 1_000_000) / energyPerTransaction  // ✓ Dynamic
    }];

    return { guid, name, priority, energy, fees, isActive: true };
}
```

**Bad example (NEVER do this):**
```typescript
// ✗ BAD: Hardcoded energy value
const ENERGY_PER_TRANSACTION = 65_000;
const fees = [{
    sun: (apiPriceInTrx * 1_000_000) / ENERGY_PER_TRANSACTION  // ✗ Inaccurate
}];
```

**Why this matters:**
- **Accuracy**: Hardcoded values are off by 1.1% (65,000 vs actual 64,285)
- **Maintainability**: If USDT contract changes, service updates automatically
- **Consistency**: All fetchers use the same accurate blockchain-measured value

See [tron-fee-energy-rental.fetcher.ts](/apps/backend/src/modules/markets/fetchers/implementations/tron-fee-energy-rental.fetcher.ts) for a complete example.

### Non-SUN Units

Convert TRX to SUN (1 TRX = 1,000,000 SUN):

```typescript
const priceInSun = priceInTrx * 1_000_000;
fees.push({ minutes: 60, sun: priceInSun / energyAmount });
```

### Ambiguous Period Fields

When APIs use numeric periods (e.g., `period: 3`) without units, check the website UI to confirm whether it means hours, days, or weeks. Standard TRON rental periods are: 1h, 3h, 1d, 3d, 7d, 30d.

### Null Collection Addresses

Filter out null values with type predicates to avoid TypeScript errors:

```typescript
const addresses = [
    data.address1 ? { address: data.address1, labels: ['collection'] } : null,
    data.address2 ? { address: data.address2, labels: ['collection'] } : null
].filter((item): item is { address: string; labels: string[] } => item !== null);
```

## Quick Reference

**Minimum required `MarketSnapshot` fields:**

```typescript
{
    guid: 'market-name',              // Unique identifier (kebab-case)
    name: 'Market Name',              // Display name
    priority: 100,                    // Sort order
    energy: {
        total: number,                // Total platform capacity
        available: number             // Currently available
    },
    fees: [{
        minutes: number,              // REQUIRED for regeneration
        sun: number                   // REQUIRED per-unit price
    }],
    isActive: true
}
```

See `MarketSnapshot` type definition in [market-snapshot.dto.ts](/apps/backend/src/modules/markets/dtos/market-snapshot.dto.ts) for all optional fields (addresses, social links, affiliate data, metadata).

**Pre-submission checklist:**

- [ ] `fees` array includes `minutes` and `sun` for each pricing tier
- [ ] `sun` is per-unit price (not total bundle price)
- [ ] TypeScript compiles (`npm run typecheck --workspace apps/backend`)
- [ ] Fetcher registered in `fetcher-registry.ts`
- [ ] Backend builds and starts without errors
- [ ] Market appears in `/api/markets` with populated `pricingDetail`
- [ ] `minUsdtTransferCost` shows reasonable value
- [ ] Frontend leaderboard displays market correctly

## Market Fetcher Scheduling

### How Scheduling Works

All market fetchers execute together via a centralized `markets:refresh` cron job that runs every **10 minutes** by default (`*/10 * * * *`). Individual fetchers no longer have their own schedules.

**Key points:**

- **Centralized scheduling** - All fetchers run together as a single batch job
- **Admin-configurable** - System administrators can adjust the refresh interval via the admin UI (System > Scheduler section)
- **Single schedule** - Uses one cron expression for all market data, simplifying operations
- **No immediate execution on startup** - Fetchers only run at their scheduled intervals, not when the backend starts
- **Data persists** - Market data is stored in MongoDB and survives restarts, so old data remains until the next scheduled fetch

**How to adjust the schedule:**

1. Open the system monitor at `http://localhost:3000/system` (requires `ADMIN_API_TOKEN`)
2. Navigate to the **Scheduler** section
3. Find the `markets:refresh` job and update its cron expression
4. Changes take effect immediately without requiring a rebuild

### Scheduler Architecture

The centralized scheduler service runs all market fetchers together on a fixed schedule:

1. **Registration** - Fetchers are registered in [fetcher-registry.ts](/apps/backend/src/modules/markets/fetchers/fetcher-registry.ts)
2. **Batch execution** - The `markets:refresh` job calls `refreshMarkets()` which iterates through all registered fetchers
3. **Sequential execution** - Each fetcher's `pull()` method runs in sequence within the batch job
4. **Storage** - Market snapshots are saved to MongoDB and served to the frontend

**Why this matters for development:**

- **After rebuilding code** - Old data remains in the database until the next scheduled batch execution (up to 10 minutes)
- **Testing new fetchers** - You must wait for the scheduler to run or manually trigger a market refresh via the admin API
- **`--force-build` doesn't refresh data** - It only rebuilds code, it doesn't clear or re-fetch market data

**Solution: Wait for the scheduler or manually trigger a refresh**

```bash
# Wait for the scheduler (10 minutes max)
sleep 600

# Or manually trigger via admin API
curl -X POST http://localhost:4000/api/admin/markets/your-market/refresh \
  -H "x-admin-token: your-admin-token" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'

# Or clear market data to force re-fetch on next cycle
docker exec tronrelic-mongo mongosh tronrelic --quiet --eval "db.markets.deleteMany({guid: 'market-name'})"
# Then wait for the scheduler to re-fetch (up to 10 minutes)
```

### Default Schedule and Customization

Market fetchers run together every **10 minutes** by default to:

- **Provide consistent data freshness** across all markets
- **Simplify operations** - one schedule for all market data, no per-fetcher configuration
- **Balance API rate limits** - 10 minutes is frequent enough for users while being respectful of external APIs
- **Distribute load** - All fetchers execute within the same batch, reducing overall resource consumption

**Custom schedules:**

Administrators can adjust the interval via the admin UI without modifying code or rebuilding. Common intervals:
- `*/5 * * * *` - Every 5 minutes (more frequent, higher API load)
- `*/10 * * * *` - Every 10 minutes (default, balanced)
- `*/15 * * * *` - Every 15 minutes (less frequent, lower API load)
- `0 * * * *` - Hourly (minimal API consumption)

## Related Documentation

- [market-system-architecture.md](./market-system-architecture.md) - Complete market system architecture and normalization pipeline
- [Reference implementations](/apps/backend/src/modules/markets/fetchers/implementations/) - Brutus Finance, TronSave, Tron Energy fetchers
