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