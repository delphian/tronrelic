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

The Telegram bot uses database-backed configuration for runtime management without requiring backend restarts. Bot token and webhook secret are configured via the admin UI, not environment variables.

**Optional environment variables** (add to `.env` file if customization needed):

```bash
# Security - IP allowlist for webhook validation
TELEGRAM_IP_ALLOWLIST=149.154.167.197/32,149.154.167.198/32,91.108.4.0/22,91.108.8.0/22

# Notifications - Channel IDs for automated alerts
TELEGRAM_MEMO_CHANNEL_ID=-1001234567890
TELEGRAM_SUNPUMP_CHANNEL_ID=-1009876543210
TELEGRAM_WHALE_CHANNEL_ID=-1009876543210

# Notifications - Thread IDs within channels (optional)
TELEGRAM_MEMO_THREAD_ID=123
TELEGRAM_SUNPUMP_THREAD_ID=456
TELEGRAM_WHALE_THREAD_ID=789

# Mini App - Telegram Web App URL
TELEGRAM_MINI_APP_URL=https://t.me/TronRelicBot/TronRelicApp

# Retry Configuration
TELEGRAM_SEND_MAX_RETRIES=3
TELEGRAM_SEND_RETRY_DELAY_MS=500
```

See [Configuration Reference](#configuration-reference) below for detailed descriptions of each variable.

### 3. Install and Enable Plugin

1. Navigate to `http://localhost:3000/system/plugins`
2. Find "Telegram Bot" in the plugin list
3. Click "Install"
4. Click "Enable"
5. Plugin is now active

### 4. Configure Bot Token and Webhook Secret

1. Get your bot token from [@BotFather](https://t.me/botfather) on Telegram:
   - Message [@BotFather](https://t.me/botfather) on Telegram
   - Send `/newbot` and follow instructions
   - Copy the token: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

2. Navigate to `http://localhost:3000/system/plugins/telegram-bot/settings`

3. Configure bot token:
   - Enter your bot token in the "Bot Token" field
   - Click "Save Settings"

4. Configure webhook secret:
   - Scroll to "Webhook Secret" field
   - Click "Generate New Secret" to create a secure 32-character hex string (or enter your own, minimum 16 characters)
   - Click "Save Settings"
   - Configuration is stored securely in MongoDB

**Benefits of database-backed configuration:**
- Change bot token or webhook secret without restarting backend
- Automatic token masking in API responses (shows `***...xyz` instead of full token)
- Runtime configuration changes via web interface
- Centralized management in one location

### 5. Register Webhook with Telegram

After configuring the bot token and webhook secret, you need to register the webhook URL with Telegram:

**Option 1: Automatic Registration (Recommended)**

1. Still on the settings page, scroll down to the "Webhook Configuration" card
2. Click "Register Webhook" button
3. The backend will automatically register the webhook with Telegram using your stored bot token
4. Click "Verify" to confirm the webhook is correctly configured

**Option 2: Manual Registration**

1. Copy the webhook URL displayed in the "Webhook Configuration" card
2. Open Telegram and message `@BotFather`
3. Send `/setwebhook` command
4. Select your bot
5. Paste the webhook URL
6. BotFather confirms setup

**Security Note:** The webhook is protected by IP allowlist and webhook secret validation. Only Telegram's official servers can send updates to this endpoint.

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

## Configuration Reference

### Bot Token and Webhook Secret (Database-Backed)

**⚠️ These are NO LONGER configured via environment variables.**

Both the bot token and webhook secret are managed through the admin UI at `/system/plugins/telegram-bot/settings` and stored securely in MongoDB.

**Benefits:**
- Change configuration without restarting backend
- Automatic token masking in API responses
- Runtime configuration changes via web interface
- Audit trail through database timestamps
- Secure storage with encrypted database connections

**Security:**
- Bot token is stored in MongoDB with automatic migration from legacy environment variables
- Webhook secret must be at least 16 characters long
- Recommended: Use the "Generate New Secret" button for cryptographically secure 32-character hex strings
- Secret is validated on every incoming webhook request
- Used alongside IP allowlist for defense-in-depth

### Environment Variables

#### TELEGRAM_IP_ALLOWLIST
- **Type:** `string` (CIDR ranges, comma-separated)
- **Default:** `149.154.167.197/32,149.154.167.198/32,91.108.4.0/22,91.108.8.0/22`
- **Required:** No

IP address ranges allowed to send webhook requests. Provides additional security layer beyond webhook secret validation.

**Default Value:** Telegram's official IP ranges

**When to Change:** If Telegram updates their IP ranges (rare) or you're testing webhooks locally

#### TELEGRAM_MEMO_CHANNEL_ID
#### TELEGRAM_SUNPUMP_CHANNEL_ID
#### TELEGRAM_WHALE_CHANNEL_ID
- **Type:** `string` (channel ID)
- **Default:** None
- **Required:** No (required if using whale-alerts plugin notifications)

Telegram channel IDs for posting automated notifications from the whale-alerts plugin.

**How to Get Channel ID:**
1. Create a Telegram channel
2. Add your bot as admin
3. Forward a message from the channel to [@userinfobot](https://t.me/userinfobot)
4. Bot will reply with channel ID (format: `-1001234567890`)

**Example:**
```bash
TELEGRAM_MEMO_CHANNEL_ID=-1001234567890
TELEGRAM_SUNPUMP_CHANNEL_ID=-1009876543210
TELEGRAM_WHALE_CHANNEL_ID=-1009876543210
```

#### TELEGRAM_MEMO_THREAD_ID
#### TELEGRAM_SUNPUMP_THREAD_ID
#### TELEGRAM_WHALE_THREAD_ID
- **Type:** `string` or `number`
- **Default:** None
- **Required:** No

Thread/topic ID within a channel for organizing messages. If your channel has multiple topics enabled, you can send different notification types to different topics.

#### TELEGRAM_MINI_APP_URL
- **Type:** `string` (URL)
- **Default:** `https://t.me/TronRelicBot/TronRelicApp`
- **Required:** No

URL for the Telegram Mini App (Web App).

**Format:** `https://t.me/{bot_username}/{app_shortname}`

#### TELEGRAM_SEND_MAX_RETRIES
- **Type:** `number`
- **Default:** `3`
- **Required:** No

How many times to retry sending Telegram messages if they fail.

#### TELEGRAM_SEND_RETRY_DELAY_MS
- **Type:** `number` (milliseconds)
- **Default:** `500`
- **Required:** No

Delay between Telegram send retries.

---

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
