# Telegram Bot Plugin

Complete Telegram bot integration for TronRelic. Handles webhook callbacks, command processing, market queries, and user management.

## Features

### Bot Commands

- `/start` - Welcome message and command list
- `/price` - Get cheapest market price for 1 USDT transfer
- `/price <amount>` - Get price for multiple transfers (e.g., `/price 100`)
- `/price <amount> <days>` - Get price with energy regeneration (e.g., `/price 100 30`)
- `/subscribe` - Subscribe to notifications (stub, future feature)
- `/unsubscribe` - Unsubscribe from notifications (stub, future feature)

### Security Features

- **IP Allowlist** - Only Telegram's official servers can send webhooks
- **Webhook Secret** - Additional validation using custom secret token
- **Rate Limiting** - Per-user command throttling (configurable)

### Admin Features

- Webhook configuration display
- User statistics and activity monitoring
- Test notification sender
- Subscription type management (future)

## Installation

### 1. Build the Plugin

```bash
# From repository root
npm run build --workspace packages/plugins/telegram-bot
```

### 2. Configure Environment Variables

Add these to your `.env` file:

```bash
# Optional - Generate with: openssl rand -hex 32
TELEGRAM_WEBHOOK_SECRET=your-generated-secret-here

# Optional - Telegram's official IPs (defaults provided)
TELEGRAM_IP_ALLOWLIST=149.154.160.0/20,91.108.4.0/22

# Required - Backend API URL for market queries
BACKEND_API_URL=http://localhost:4000/api

# Required - Site URL for webhook generation
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Note:** Bot token is now configured via the admin UI at `/system/settings` (stored in database). Get your token from [@BotFather](https://t.me/botfather) on Telegram.

### 3. Install and Enable Plugin

1. Navigate to `http://localhost:3000/system/plugins`
2. Find "Telegram Bot" in the plugin list
3. Click "Install"
4. Click "Enable"
5. Plugin is now active

### 4. Configure Telegram Webhook

1. Navigate to `http://localhost:3000/system/plugins/telegram-bot/settings`
2. Copy the webhook URL displayed
3. Open Telegram and message `@BotFather`
4. Send `/setwebhook` command
5. Select your bot
6. Paste the webhook URL
7. BotFather confirms setup

## Usage

### User Commands

Users interact with the bot via Telegram DMs:

```
User: /start
Bot: 🤖 Welcome to TronRelic Bot!
     I can help you with:
     💰 Market Prices
     • /price - Get cheapest USDT transfer cost
     ...

User: /price
Bot: 💰 Cheapest Market Price
     Provider: Tron Save
     Duration: 1 day
     Transfers: 1
     Cost per transfer: 0.123456 TRX
     Total cost: 0.123456 TRX

User: /price 100 30
Bot: 💰 Cheapest Market Price
     Provider: Energy Rental
     Duration: 30 days
     Transfers: 100
     Cost per transfer: 0.045678 TRX
     Total cost: 4.567800 TRX
```

### Admin Monitoring

Access admin dashboard at `/system/plugins/telegram-bot/settings`:

- View total users and 24h active users
- Monitor command usage
- Send test notifications
- View subscription breakdown

## Architecture

### Backend Components

- `backend.ts` - Plugin entry point with lifecycle hooks
- `webhook-handler.ts` - Processes Telegram webhook callbacks
- `command-handlers.ts` - Implements bot command logic
- `market-query.service.ts` - Queries market data API
- `security.ts` - IP allowlist and webhook secret validation
- `telegram-bot.service.ts` - Plugin-to-plugin service stub

### Frontend Components

- `frontend.ts` - Registers admin page and menu item
- `TelegramBotSettingsPage.tsx` - Main admin settings page
- `UserStatsCard.tsx` - Displays user statistics
- `WebhookConfigCard.tsx` - Shows webhook URL and setup instructions

### Database Collections

- `users` - Tracks Telegram users and interactions
  - Indexed on: `telegramId` (unique), `lastInteraction`, `createdAt`
- `subscriptions` - Subscription types available to users
  - Seeded with default types on install

### API Routes

- `POST /api/plugins/telegram-bot/webhook` - Telegram webhook endpoint
- `GET /api/plugins/telegram-bot/system/stats` - User statistics (admin)
- `POST /api/plugins/telegram-bot/system/test` - Send test notification (admin, stub)
- `GET /api/plugins/telegram-bot/config` - Get plugin configuration

## Plugin-to-Plugin Service Architecture

This plugin includes a stub implementation of a service that other plugins can consume. See `telegram-bot.service.ts` for detailed documentation.

**Proposed usage (future):**

```typescript
// In whale-alerts plugin
const telegramService = context.serviceRegistry.get<ITelegramBotService>('telegram-bot');

if (telegramService) {
    await telegramService.sendNotification(userId, 'Whale detected!');
}
```

**Benefits:**
- Plugins remain decoupled (no cross-package imports)
- Services are optional (graceful degradation)
- Type-safe interfaces
- Testable with mocks

**Requirements:**
- Add `serviceRegistry` to `IPluginContext` interface
- Implement registry in backend plugin loader
- Register service in `init()` hook

## Troubleshooting

### Webhook not receiving updates

1. Check webhook URL is configured in BotFather
2. Verify bot token is configured correctly via `/system/settings` admin UI
3. Check backend logs for security validation failures
4. Ensure site is publicly accessible (not localhost in production)

### IP validation failing

1. Check `TELEGRAM_IP_ALLOWLIST` includes Telegram's current IPs
2. Verify request IP in logs matches allowlist
3. Disable IP validation temporarily to test (not recommended for production)

### Market queries returning errors

1. Verify `BACKEND_API_URL` points to correct backend
2. Check markets API is responding: `curl http://localhost:4000/api/markets`
3. Ensure markets have been fetched (check `/system/markets` admin page)
4. Review backend logs for market fetcher errors

### Commands not responding

1. Check bot is enabled in `/system/plugins`
2. Verify user is sending DMs (not group messages)
3. Check command syntax matches documentation
4. Review backend logs for command processing errors

## Development

### Building

```bash
npm run build --workspace packages/plugins/telegram-bot
```

### Watching for Changes

```bash
# Backend (TypeScript compilation)
npm run build --workspace packages/plugins/telegram-bot -- --watch

# Frontend (handled by Next.js)
npm run dev --workspace apps/frontend
```

### Testing Locally

1. Use ngrok or similar to expose localhost webhook:
   ```bash
   ngrok http 3000
   ```

2. Update `.env` with ngrok URL:
   ```bash
   NEXT_PUBLIC_SITE_URL=https://your-id.ngrok.io
   ```

3. Restart backend to regenerate webhook URL

4. Configure webhook in BotFather with ngrok URL

## Future Enhancements

- [ ] Implement subscription system (database layer exists)
- [ ] Add test notification endpoint (UI exists)
- [ ] Implement plugin-to-plugin service registry
- [ ] Add rate limiting per user
- [ ] Add admin stats endpoint implementation
- [ ] Support callback query handling
- [ ] Add inline keyboard buttons
- [ ] Integrate with whale-alerts plugin for notifications

## License

MIT
