# TronRelic TODO

## Docker Build Target Naming
**Note:** The `frontend-dev` build target should be renamed to `frontend-local` to avoid confusion. Currently, the dev server deployment actually uses `frontend-prod` target, which is inconsistent with the naming convention. This should be addressed in a future refactor to clarify that:
- `frontend-local` = development build with hot reloading for local development
- `frontend-prod` = optimized production build for both dev and prod servers

## Custom User Created Pages

Let's talk about custom, user created, pages. I would like a new backend module, colocated components, similar file structure layout as modules/menu and services/system-log. This new module will be called 'pages'. The purpose of this module is to allow the admin to create custom pages on the site, such as articles, blog posts, etc. I don't foresee a need for page types.

## Telegram Bot Periodic Updates

**Note:** These features should be implemented by separate plugins that use the telegram-bot plugin as a delivery mechanism only. Each plugin would generate its own data and call telegram-bot APIs to post updates.

Network activity summaries would be valuable for giving channel members a pulse on TRON blockchain health. Posting hourly or daily digests showing total transaction volume, block processing rate, and current network utilization helps subscribers understand if the chain is experiencing normal activity or unusual spikes. This could include simple metrics like "processed 2,847 blocks in the last hour with 156,432 transactions" or "network is currently at 73% of typical daily volume."

Whale activity highlights would capture attention and provide real-time market intelligence. When large TRX or USDT transfers occur above certain thresholds (configurable, perhaps 1M TRX or 500k USDT), the bot could post brief alerts with transaction hashes and wallet addresses. These alerts help traders and analysts spot potential market-moving events before they impact prices. A daily rollup summarizing the largest transfers and most active whale wallets would complement the real-time alerts.

Energy market insights would serve users looking for cost-effective TRON resource rentals. Posting daily or twice-daily updates showing which platforms currently offer the best energy rental rates, along with price trend analysis (rising, falling, stable), helps channel members make informed decisions about when and where to rent energy. Highlighting sudden price drops or unusually good deals would add immediate actionable value for DeFi participants managing transaction costs.

## CSS Preprocessor Investigation for Breakpoint Variables

**Context:** CSS custom properties (variables) cannot be used in `@media` or `@container` query conditions due to CSS specification limitations. This forces us to use hardcoded pixel values for breakpoints throughout the codebase, which reduces maintainability and creates potential for inconsistency with our design token system.

**Intent:** Investigate CSS preprocessors (Sass, Less, PostCSS with custom plugins) to enable compile-time variable substitution for breakpoints. This would allow us to:
- Define breakpoints once in a central location (e.g., `$breakpoint-mobile: 768px`)
- Reference them in media/container queries (e.g., `@container (max-width: $breakpoint-mobile)`)
- Maintain design system consistency without runtime CSS variable limitations
- Automatically update all breakpoint references when design tokens change

**Considerations:**
- Integration with Next.js build pipeline
- Impact on build performance
- Developer experience and tooling setup
- Migration strategy for existing hardcoded breakpoints
- Documentation updates for new workflow

**Related files:**
- `apps/frontend/app/primitives.css` - Current breakpoint token definitions
- `apps/frontend/app/globals.css` - Documents CSS variable limitations
- Component CSS Modules using hardcoded breakpoints (e.g., `RecentWhaleDelegations.module.css`)

## Inject Mongoose into DatabaseService

**Context:** DatabaseService currently imports mongoose directly rather than receiving it via dependency injection. This creates testing complexity where we must mock the mongoose module itself, and prevents flexible test strategies like using a real DatabaseService with a mocked mongoose connection.

**Current architecture:**
```typescript
// DatabaseService.ts
import mongoose from 'mongoose';

export class DatabaseService implements IDatabaseService {
    constructor(logger: ISystemLogService, options?: { prefix?: string }) {
        // Direct coupling to global mongoose.connection
        this.db = mongoose.connection.db;
    }
}
```

**Proposed architecture:**
```typescript
// DatabaseService.ts
export class DatabaseService implements IDatabaseService {
    constructor(
        logger: ISystemLogService,
        mongooseConnection: Connection,  // Injected
        options?: { prefix?: string }
    ) {
        this.db = mongooseConnection.db;
    }
}
```

**Benefits:**
- **Better testability** - Can pass real or mocked mongoose connections without vi.mock()
- **Flexibility** - Consumer tests could use real DatabaseService with mocked connection
- **Dependency inversion** - DatabaseService declares what it needs rather than importing it
- **Cleaner mocks** - Single centralized IDatabaseService mock for all consumer tests
- **Integration testing** - Can test DatabaseService against real MongoDB in integration tests

**Current workarounds:**
1. Centralized mongoose mock (`apps/backend/src/tests/vitest/mocks/mongoose.ts`) - For DatabaseService internal tests
2. Multiple local IDatabaseService mocks - For consumer tests (PageService, ThemeModule, etc.)

**Migration considerations:**
- Update DatabaseModule to pass mongoose.connection to DatabaseService constructor
- Update all module initialization code that creates DatabaseService instances
- Update PluginDatabaseService to accept injected connection
- Consolidate 5+ local IDatabaseService mocks into single centralized mock
- Preserve backward compatibility during transition

**Related files:**
- `apps/backend/src/modules/database/services/database.service.ts` - DatabaseService implementation
- `apps/backend/src/modules/database/DatabaseModule.ts` - DatabaseService instantiation
- `apps/backend/src/modules/pages/__tests__/page.service.test.ts` - Example local mock
- `apps/backend/src/tests/vitest/mocks/mongoose.ts` - Centralized mongoose mock

## Review Unused API URL Helper Functions

**Context:** The `getClientSideApiUrlWithPath()` and potentially `getClientSideApiUrl()` helper functions exist in `apps/frontend/lib/api-url.ts` but have zero usage across the entire frontend codebase. All client-side API calls use hardcoded `/api` paths that rely on Next.js rewrites (configured in `next.config.mjs`) to route requests to the backend.

**Current pattern (used throughout codebase):**
```typescript
// Hardcoded /api path - Next.js rewrites handle environment routing
fetch('/api/admin/pages', { ... })
```

**Unused helper pattern:**
```typescript
// Helper exists but is never used
const apiUrl = getClientSideApiUrlWithPath();
fetch(`${apiUrl}/admin/pages`, { ... })
```

**Questions to investigate:**
1. Should we standardize on the helper function pattern for explicitness?
2. Should we remove the unused helper functions to reduce maintenance burden?
3. Are there edge cases where hardcoded `/api` paths fail that the helpers would prevent?
4. Does the rewrite approach have performance implications vs explicit URL construction?

**Recommendation needed on:**
- Keep helpers and migrate all calls to use them (consistency via helpers)
- Remove helpers and document rewrite pattern as standard (consistency via rewrites)
- Keep both patterns for flexibility (current state, but inconsistent)

**Related files:**
- `apps/frontend/lib/api-url.ts` - Helper function definitions
- `apps/frontend/next.config.mjs` - Next.js rewrite rules
- `apps/frontend/app/(dashboard)/system/pages/**/*.tsx` - Example hardcoded usage