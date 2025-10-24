# Environment Variables Reference

Complete documentation for all environment variables used in TronRelic.com.

## Quick Start

**Minimal Configuration (Get it Running):**
```bash
# Required for backend
MONGODB_URI=mongodb://127.0.0.1:27017/tronrelic
REDIS_URL=redis://127.0.0.1:6379

# Required for frontend
NEXT_PUBLIC_API_URL=http://localhost:4000/api
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000
NEXT_PUBLIC_SITE_URL=http://localhost:3000
```

**Full Development Configuration:**
```bash
# Copy template and edit
cp .env.example apps/backend/.env

# Enable all features to see live data processing
ENABLE_SCHEDULER=true
ENABLE_WEBSOCKETS=true
ENABLE_TELEMETRY=true

# Add admin token to access system monitoring
ADMIN_API_TOKEN=dev-admin-token-123
```

---

## Core Configuration

### NODE_ENV
- **Type:** `string` (enum)
- **Default:** `development`
- **Valid Values:** `development`, `test`, `staging`, `production`
- **Required:** No

**Description:** Sets the application environment mode. Affects logging verbosity, error reporting, and performance optimizations.

**When to Change:**
- Use `development` for local development (verbose logging, hot reload)
- Use `production` for deployed environments (optimized, minimal logging)
- Use `test` for automated testing
- Use `staging` for pre-production testing

---

### PORT
- **Type:** `number`
- **Default:** `4000`
- **Required:** No

**Description:** The port the backend HTTP server listens on.

**Example Values:**
- `4000` - Default development port
- `8080` - Common alternative
- `80` - Standard HTTP (requires root/elevated permissions)
- `443` - Standard HTTPS (requires root/elevated permissions)

**When to Change:** If port 4000 is already in use on your system or you're deploying behind a proxy.

---

## Database Configuration

### MONGODB_URI
- **Type:** `string` (MongoDB connection string)
- **Default:** None
- **Required:** ✅ **Yes**

**Description:** MongoDB database connection string. All transaction data, market prices, and system state are stored here.

**Example Values:**
```bash
# Local development
MONGODB_URI=mongodb://127.0.0.1:27017/tronrelic

# Docker container
MONGODB_URI=mongodb://tronrelic-mongo:27017/tronrelic

# MongoDB Atlas (cloud)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/tronrelic?retryWrites=true&w=majority

# Replica set
MONGODB_URI=mongodb://host1:27017,host2:27017,host3:27017/tronrelic?replicaSet=rs0
```

**Important:** Keep credentials secure. Never commit connection strings with passwords to version control.

---

### REDIS_URL
- **Type:** `string` (Redis connection URL)
- **Default:** None
- **Required:** ✅ **Yes**

**Description:** Redis cache connection URL. Used for caching market data, API responses, and session storage. Critical for performance.

**Example Values:**
```bash
# Local development
REDIS_URL=redis://127.0.0.1:6379

# With password
REDIS_URL=redis://:password@127.0.0.1:6379

# Docker container
REDIS_URL=redis://tronrelic-redis:6379

# Redis Cloud
REDIS_URL=redis://:password@redis-12345.cloud.redislabs.com:12345

# Redis Sentinel
REDIS_URL=redis-sentinel://host1:26379,host2:26379/mymaster
```

**Performance Impact:** All API endpoints use Redis for caching. Without Redis, the application will not start.

---

### REDIS_NAMESPACE
- **Type:** `string`
- **Default:** `tronrelic`
- **Required:** No

**Description:** Prefix for all Redis keys. Useful when sharing a Redis instance across multiple applications or environments.

**Example Values:**
- `tronrelic` - Default namespace
- `tronrelic-dev` - Development environment
- `tronrelic-staging` - Staging environment
- `app1` - If sharing Redis with other apps

**When to Change:** If you're running multiple instances of the app (dev/staging/prod) against the same Redis server.

---

## Feature Flags

### ENABLE_SCHEDULER
- **Type:** `boolean`
- **Default:** `true`
- **Required:** No
- **Accepts:** `true`, `false`, `1`, `0`, `yes`, `no`, `on`, `off`, or empty string

**Description:** Controls whether the cron job scheduler runs. When enabled, periodic jobs execute automatically (market refresh, blockchain sync, cache cleanup, alerts dispatch, chain parameter fetching).

See [system-scheduler-operations.md](./system/system-scheduler-operations.md) for complete job details, schedules, and runtime control.

**When to Enable:**
- ✅ Production deployment (data must be live and fresh)
- ✅ Development when testing live data flows
- ✅ When you want to see the system monitoring dashboard populate with real data

**When to Disable:**
- ❌ Running unit tests (prevents background jobs from interfering)
- ❌ Doing quick smoke tests without needing live data
- ❌ Debugging specific API endpoints without background noise
- ❌ Want to avoid TronGrid API rate limits during development

**Example:**
```bash
# Enable - any of these work
ENABLE_SCHEDULER=true
ENABLE_SCHEDULER=1
ENABLE_SCHEDULER=yes
ENABLE_SCHEDULER=on

# Disable - any of these work
ENABLE_SCHEDULER=false
ENABLE_SCHEDULER=0
ENABLE_SCHEDULER=no
ENABLE_SCHEDULER=off
ENABLE_SCHEDULER=        # Empty string also disables
```

---

### ENABLE_WEBSOCKETS
- **Type:** `boolean`
- **Default:** `true`
- **Required:** No

**Description:** Controls whether Socket.IO WebSocket server starts for real-time updates (whale transactions, market prices, blockchain events).

See [system-api.md](./system/system-api.md#websocket-events-reference) for complete event documentation and subscription patterns.

**When to Enable:**
- ✅ Production (users expect real-time updates)
- ✅ Development when testing real-time features
- ✅ When testing the frontend with live data

**When to Disable:**
- ❌ Server-side rendering only (no browser clients)
- ❌ Debugging issues with WebSocket connections
- ❌ Running behind a proxy that doesn't support WebSockets

**Performance Impact:** Minimal. WebSocket connections are idle until events occur.

---

### ENABLE_TELEMETRY
- **Type:** `boolean`
- **Default:** `true`
- **Required:** No

**Description:** Controls whether Prometheus metrics are exposed at `/metrics` endpoint. Tracks HTTP performance, database queries, cache efficiency, resource usage, and custom business metrics.

**When to Enable:**
- ✅ Production (monitoring is critical)
- ✅ Staging (performance testing)
- ✅ Development when using Grafana dashboard

**When to Disable:**
- ❌ Privacy-sensitive environments
- ❌ When metrics collection overhead is a concern (minimal impact)

**Observability Stack:** See `ops/observability/docker-compose.yml` for Grafana + Prometheus setup.

---

## Security & Authentication

### ADMIN_API_TOKEN
- **Type:** `string`
- **Default:** None (empty)
- **Required:** No (but required to access admin endpoints)
- **⚠️ Security:** Must be set to access `/system` monitoring dashboard

**Description:** Bearer token for accessing admin-only API endpoints. Required for:
- System monitoring dashboard (`/system`)
- Market administration (`/admin/markets`)
- Moderation tools (`/admin/moderation`)

**Setup:**
```bash
# Development
ADMIN_API_TOKEN=dev-admin-token

# Production - generate with: openssl rand -hex 32
ADMIN_API_TOKEN=<paste-generated-token-here>
```

**Usage:**
```bash
# In browser localStorage for /system page
localStorage.setItem('admin_token', 'your-token-here')

# In API requests
curl -H "X-Admin-Token: your-token-here" http://localhost:4000/api/admin/system/overview
```

**Security:** If not set, all admin endpoints return 503 Service Unavailable. This allows you to disable admin access entirely by omitting the variable.

---

### METRICS_TOKEN
- **Type:** `string`
- **Default:** None (empty)
- **Required:** No

**Description:** Optional token for protecting the `/metrics` endpoint. If set, Prometheus must include this token in requests.

**When to Use:**
- Production environments where you want to restrict metrics access
- When exposing metrics endpoint publicly

**Configuration:**
```bash
# Backend
METRICS_TOKEN=metrics-secret-123

# Prometheus scrape config (prometheus.yml)
scrape_configs:
  - job_name: 'tronrelic'
    bearer_token: 'metrics-secret-123'
    static_configs:
      - targets: ['backend:4000']
```

---

## Blockchain Integration

### TRONGRID_API_KEY
- **Type:** `string`
- **Default:** None (empty)
- **Required:** No (but strongly recommended)

**Description:** API key for TronGrid (official TRON blockchain API provider). Provides higher rate limits and better reliability.

**Without API Key:**
- ✅ Application works
- ⚠️ Limited to 100 requests/second
- ⚠️ May encounter rate limiting during blockchain sync
- ⚠️ Shared IP-based rate limits with other users

**With API Key:**
- ✅ 1,000 requests/second rate limit
- ✅ Dedicated rate limiting
- ✅ Better reliability
- ✅ Support available

**How to Get:**
1. Visit https://www.trongrid.io/
2. Sign up for free account
3. Generate API key
4. Add to `.env`:
   ```bash
   TRONGRID_API_KEY=your-api-key-here
   ```

**Usage in Code:** Automatically included in `TRON-PRO-API-KEY` header for all TronGrid requests (see `tron-grid.client.ts`).

---

## Rate Limiting & Throttling

### NOTIFICATION_WEBSOCKET_THROTTLE_MS
- **Type:** `number` (milliseconds)
- **Default:** `5000` (5 seconds)
- **Required:** No

**Description:** Minimum time between WebSocket notifications to the same user. Prevents notification spam.

**Example:** If a user's wallet is involved in 100 transactions per second, they'll only receive a WebSocket notification every 5 seconds.

---

### NOTIFICATION_TELEGRAM_THROTTLE_MS
- **Type:** `number` (milliseconds)
- **Default:** `60000` (1 minute)
- **Required:** No

**Description:** Minimum time between Telegram notifications to the same user.

**Why Higher Than WebSocket:** Telegram has rate limits and users find frequent Telegram messages more annoying than WebSocket updates.

---

### NOTIFICATION_EMAIL_THROTTLE_MS
- **Type:** `number` (milliseconds)
- **Default:** `300000` (5 minutes)
- **Required:** No

**Description:** Minimum time between email notifications to the same user.

**Why Highest:** Email has higher delivery costs and users expect fewer, more important emails.

---

## Object Storage (S3/R2)

All storage variables are optional. Used for uploaded files and attachments.

### STORAGE_ENDPOINT
- **Type:** `string` (URL)
- **Default:** None
- **Required:** No (but needed for file uploads)

**Description:** S3-compatible storage endpoint URL.

**Example Values:**
```bash
# AWS S3 (use region-specific endpoint)
STORAGE_ENDPOINT=https://s3.us-west-2.amazonaws.com

# Cloudflare R2
STORAGE_ENDPOINT=https://your-account-id.r2.cloudflarestorage.com

# MinIO (self-hosted)
STORAGE_ENDPOINT=http://minio.local:9000

# DigitalOcean Spaces
STORAGE_ENDPOINT=https://nyc3.digitaloceanspaces.com
```

---

### STORAGE_REGION
- **Type:** `string`
- **Default:** None
- **Required:** No

**Description:** AWS region or equivalent for the storage provider.

**Example Values:**
- `us-west-2` - AWS Oregon
- `us-east-1` - AWS Virginia
- `auto` - Cloudflare R2 (region selection automatic)

---

### STORAGE_BUCKET
- **Type:** `string`
- **Default:** None
- **Required:** No (required for uploads)

**Description:** Name of the S3 bucket where files are stored.

**Example:** `tronrelic-attachments`

---

### STORAGE_ACCESS_KEY_ID
- **Type:** `string`
- **Default:** None
- **Required:** No (required for uploads)
- **⚠️ Security:** Keep secret

**Description:** S3 access key ID for authentication.

---

### STORAGE_SECRET_ACCESS_KEY
- **Type:** `string`
- **Default:** None
- **Required:** No (required for uploads)
- **⚠️ Security:** Keep secret, never commit to version control

**Description:** S3 secret access key for authentication.

---

### STORAGE_FORCE_PATH_STYLE
- **Type:** `boolean`
- **Default:** `false`
- **Required:** No

**Description:** Use path-style S3 URLs instead of virtual-hosted style.

**When to Enable:**
- ✅ Using MinIO (self-hosted S3)
- ✅ Using custom S3-compatible storage
- ✅ Testing with LocalStack

**URL Styles:**
```bash
# Virtual-hosted (default)
https://bucket-name.s3.amazonaws.com/file.jpg

# Path-style (STORAGE_FORCE_PATH_STYLE=true)
https://s3.amazonaws.com/bucket-name/file.jpg
```

---

## Telegram Integration

The Telegram bot uses database-backed configuration for runtime management without requiring backend restarts.

### Bot Token Configuration

**⚠️ Bot tokens are NO LONGER configured via environment variables.**

The Telegram bot token is now managed through the admin UI:

1. **Obtain token from BotFather:**
   - Message [@BotFather](https://t.me/botfather) on Telegram
   - Send `/newbot` and follow instructions
   - Copy the token: `123456789:ABCdefGHIjklMNOpqrsTUVwxyz`

2. **Configure via admin UI:**
   - Navigate to `/system/plugins` in your TronRelic instance
   - Locate the "telegram-bot" plugin
   - Click "Settings" to access the configuration panel
   - Enter your bot token in the secure settings form
   - Token is stored in MongoDB with automatic migration from legacy environment variables

3. **Benefits of database-backed configuration:**
   - Change bot token without restarting backend
   - Automatic token masking in API responses (shows `***...xyz` instead of full token)
   - Centralized management alongside other plugin settings
   - Secure storage with encrypted database connections

**Features Enabled:**
- Real-time market price queries via `/price` command
- Whale transaction alerts to Telegram channels (via whale-alerts plugin)
- Memo transaction notifications (via whale-alerts plugin)
- SunPump token alerts (via whale-alerts plugin)
- Telegram mini-app integration

---

### TELEGRAM_WEBHOOK_SECRET
- **Type:** `string`
- **Default:** None
- **Required:** No
- **⚠️ Security:** Must be random and secret

**Description:** Secret token for validating Telegram webhook requests. Prevents unauthorized webhook calls.

**Generate:**
```bash
openssl rand -hex 32
```

---

### TELEGRAM_IP_ALLOWLIST
- **Type:** `string` (CIDR ranges, comma-separated)
- **Default:** Telegram's official IP ranges
- **Required:** No

**Description:** IP address ranges allowed to send webhook requests. Provides additional security layer.

**Default Value:**
```bash
TELEGRAM_IP_ALLOWLIST=149.154.167.197/32,149.154.167.198/32,91.108.4.0/22,91.108.8.0/22
```

**When to Change:** If Telegram updates their IP ranges (rare) or you're testing webhooks locally.

---

### TELEGRAM_MEMO_CHANNEL_ID
### TELEGRAM_SUNPUMP_CHANNEL_ID
### TELEGRAM_WHALE_CHANNEL_ID
- **Type:** `string` (channel ID)
- **Default:** None
- **Required:** No

**Description:** Telegram channel IDs for posting automated notifications.

**How to Get Channel ID:**
1. Create a Telegram channel
2. Add your bot as admin
3. Forward a message from the channel to [@userinfobot](https://t.me/userinfobot)
4. Bot will reply with channel ID (format: `-1001234567890`)

**Example:**
```bash
TELEGRAM_MEMO_CHANNEL_ID=-1001234567890
TELEGRAM_WHALE_CHANNEL_ID=-1009876543210
```

---

### TELEGRAM_MEMO_THREAD_ID
### TELEGRAM_SUNPUMP_THREAD_ID
### TELEGRAM_WHALE_THREAD_ID
- **Type:** `string` or `number`
- **Default:** None
- **Required:** No

**Description:** Thread/topic ID within a channel for organizing messages.

**Use Case:** If your channel has multiple topics enabled, you can send different notification types to different topics.

---

### TELEGRAM_MINI_APP_URL
- **Type:** `string` (URL)
- **Default:** `https://t.me/TronRelicBot/TronRelicApp`
- **Required:** No

**Description:** URL for the Telegram Mini App (Web App).

**Format:** `https://t.me/{bot_username}/{app_shortname}`

---

### TELEGRAM_SEND_MAX_RETRIES
- **Type:** `number`
- **Default:** `3`
- **Required:** No

**Description:** How many times to retry sending Telegram messages if they fail.

---

### TELEGRAM_SEND_RETRY_DELAY_MS
- **Type:** `number` (milliseconds)
- **Default:** `500`
- **Required:** No

**Description:** Delay between Telegram send retries.

---

## Alerts & Notifications

### ALERT_WHALE_MIN_TRX
- **Type:** `string` or `number`
- **Default:** None (uses system default: 100,000 TRX)
- **Required:** No

**Description:** Minimum TRX amount for a transaction to trigger whale alerts.

**Example Values:**
- `100000` - Default (100K TRX)
- `1000000` - 1 million TRX (very large only)
- `10000` - 10K TRX (catch more transactions)

**Note:** Can also be configured via System Monitoring dashboard UI at runtime.

---

## Frontend Configuration (Next.js)

These variables must be prefixed with `NEXT_PUBLIC_` to be accessible in the browser.

### NEXT_PUBLIC_API_URL
- **Type:** `string` (URL)
- **Default:** `http://localhost:4000/api`
- **Required:** ✅ **Yes**

**Description:** Base URL for backend API. Used for both server-side and client-side API requests.

**Example Values:**
```bash
# Local development
NEXT_PUBLIC_API_URL=http://localhost:4000/api

# Production
NEXT_PUBLIC_API_URL=https://api.tronrelic.com/api

# Staging
NEXT_PUBLIC_API_URL=https://staging-api.tronrelic.com/api
```

**Important:** Must match the backend's URL and include `/api` path.

---

### NEXT_PUBLIC_SOCKET_URL
- **Type:** `string` (URL)
- **Default:** `http://localhost:4000`
- **Required:** ✅ **Yes**

**Description:** URL for Socket.IO WebSocket connections. Used for real-time updates.

**Example Values:**
```bash
# Local development
NEXT_PUBLIC_SOCKET_URL=http://localhost:4000

# Production
NEXT_PUBLIC_SOCKET_URL=https://api.tronrelic.com

# WebSocket-specific domain
NEXT_PUBLIC_SOCKET_URL=wss://ws.tronrelic.com
```

**Note:** Do NOT include `/api` in the socket URL.

---

### NEXT_PUBLIC_SITE_URL
- **Type:** `string` (URL)
- **Default:** `http://localhost:3000`
- **Required:** ✅ **Yes**

**Description:** Public URL where the frontend is accessible. Used for:
- SEO meta tags
- Canonical URLs
- Social sharing (Open Graph, Twitter Cards)
- Sitemap generation

**Example Values:**
```bash
# Local development
NEXT_PUBLIC_SITE_URL=http://localhost:3000

# Production
NEXT_PUBLIC_SITE_URL=https://tronrelic.com

# Staging
NEXT_PUBLIC_SITE_URL=https://staging.tronrelic.com
```

---

## Advanced Configuration

### Market Provider Secrets (Optional)

For overriding market provider API endpoints or affiliate links.

**Pattern:**
```bash
# Override API endpoints
MARKET_<PROVIDER_KEY>_ENDPOINT_<NAME>=https://custom-url.com

# Override site links
MARKET_<PROVIDER_KEY>_SITE_LINKS=[{"link":"https://...","text":"..."}]
```

**Example:**
```bash
MARKET_TRON_SAVE_ENDPOINT_GRAPHQL=https://api-dashboard.tronsave.io/graphql
MARKET_TRON_SAVE_SITE_LINKS=[{"link":"https://tronsave.io/?ref=abc","text":"Tron Save"}]
```

**When to Use:**
- Affiliate program participation
- Testing against different API versions
- Custom API endpoint configurations

---

### Secrets Manager Integration (Optional)

For centralized secrets management (Vault or AWS Secrets Manager).

#### MARKET_PROVIDER_SECRETS_PATH
- **Type:** `string` (file path)
- **Description:** Path to JSON file containing market provider secrets

#### MARKET_PROVIDER_SECRETS_JSON
- **Type:** `string` (JSON)
- **Description:** Inline JSON string with market provider secrets

#### HashiCorp Vault Configuration
- `MARKET_PROVIDER_SECRETS_VAULT_ADDR` - Vault server URL
- `MARKET_PROVIDER_SECRETS_VAULT_PATH` - Secret path in Vault
- `MARKET_PROVIDER_SECRETS_VAULT_TOKEN` - Vault access token

#### AWS Secrets Manager Configuration
- `MARKET_PROVIDER_SECRETS_AWS_SECRET_ID` - Secret ID in AWS
- `MARKET_PROVIDER_SECRETS_AWS_REGION` - AWS region

**Usage:**
```bash
npm run secrets:sync
```

---

## Configuration by Environment

### Development Setup
```bash
# Minimal - just get it running
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/tronrelic
REDIS_URL=redis://127.0.0.1:6379
ENABLE_SCHEDULER=false  # Disable to avoid API rate limits
ENABLE_WEBSOCKETS=true
```

### Full Development Setup (with live data)
```bash
# All features enabled
NODE_ENV=development
PORT=4000
MONGODB_URI=mongodb://127.0.0.1:27017/tronrelic
REDIS_URL=redis://127.0.0.1:6379
ENABLE_SCHEDULER=true  # Enable to see live data
ENABLE_WEBSOCKETS=true
ENABLE_TELEMETRY=true
ADMIN_API_TOKEN=dev-admin-token
TRONGRID_API_KEY=your-api-key-here  # Get from trongrid.io
```

### Production Setup
```bash
# Secure production configuration
NODE_ENV=production
PORT=4000
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/tronrelic
REDIS_URL=redis://:pass@redis.example.com:6379
ADMIN_API_TOKEN=<generate-with-openssl-rand>
ENABLE_SCHEDULER=true
ENABLE_WEBSOCKETS=true
ENABLE_TELEMETRY=true
TRONGRID_API_KEY=<your-production-api-key>

# Storage for file uploads
STORAGE_ENDPOINT=https://s3.us-west-2.amazonaws.com
STORAGE_REGION=us-west-2
STORAGE_BUCKET=tronrelic-prod-attachments
STORAGE_ACCESS_KEY_ID=<your-key>
STORAGE_SECRET_ACCESS_KEY=<your-secret>
```

---

## Pre-Deployment Security

Before deploying to production, review the security checklist in [README.md - Security Checklist](../README.md#security-checklist) and [operations-workflows.md - Production Setup](./operations/operations-workflows.md#production-setup-tronreliccom).

**Critical environment variable security practices:**
- Generate secure tokens with `openssl rand -hex 32` (ADMIN_API_TOKEN, TELEGRAM_WEBHOOK_SECRET, database passwords)
- Never commit `.env` files to version control
- Use TLS/SSL connection strings for MongoDB and Redis in production
- Rotate API keys and credentials periodically

---

## Troubleshooting Configuration Issues

For troubleshooting environment configuration problems, see:
- [README.md - Troubleshooting](../README.md#troubleshooting) - Common startup and configuration errors
- [system-scheduler-operations.md - Troubleshooting](./system/system-scheduler-operations.md#troubleshooting) - Scheduler-specific issues
- [market-system-operations.md - Troubleshooting](./markets/market-system-operations.md#troubleshooting) - Market data issues

---

## Validation

The application validates all environment variables at startup using Zod schema (`apps/backend/src/config/env.ts`).

**If validation fails:**
- Application will not start
- Error message shows which variables are invalid
- Check console output for specific validation errors

**Valid configurations:**
- Application starts normally
- No environment-related errors in logs
- System monitoring dashboard shows configuration correctly

---

## References

- **Source Code:** `apps/backend/src/config/env.ts` - Zod validation schema
- **Template:** `.env.example` - Complete example with all variables
- **Backend Config:** `apps/backend/.env` - Your actual configuration
- **Frontend Config:** `apps/frontend/.env.local` - Next.js public variables
- **System Monitoring:** Access `/system` to view runtime configuration
