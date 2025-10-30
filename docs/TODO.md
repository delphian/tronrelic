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