# Server Information and Access

This document provides the canonical reference for TronRelic server locations, authentication, and credentials. Keep this information secure and up to date as infrastructure changes.

## Why This Matters

**Risk of lost server access:**
- Deployments fail when connection details are incorrect or missing
- Security incidents occur when credentials are mismanaged or exposed
- Production outages extend when operators can't access servers during incidents
- Team velocity suffers when developers waste time searching for server information

**Benefits of centralized server documentation:**
- Single source of truth prevents conflicting or outdated information
- Documented access procedures enable quick incident response
- Standardized placeholders prevent accidental credential exposure
- Clear credential management reduces security vulnerabilities

## Server Environments

TronRelic maintains two deployment environments with distinct purposes and configurations:

### Production Server (tronrelic.com)

**Purpose:** Live production environment serving public users

- **Domain:** tronrelic.com
- **IP Address:** `<PROD_DROPLET_IP>` (stored securely, not in version control)
- **Provider:** Digital Ocean Droplet
- **Region:** (Specify region, e.g., NYC1, SFO3)
- **Deployment Directory:** `/opt/tronrelic`
- **Docker Image Tags:** `:production`
- **ENV Variable:** `ENV=production`
- **CI/CD Branch:** `main`
- **Auto-Deploy:** No (manual deployment required)

**SSH Access:**
```bash
ssh root@<PROD_DROPLET_IP>
```

**Application URLs:**
- Frontend: https://tronrelic.com/
- Backend API: https://tronrelic.com/api
- System Monitor: https://tronrelic.com/system (requires ADMIN_API_TOKEN)

### Development Server (dev.tronrelic.com)

**Purpose:** Development and staging environment for testing changes before production

- **Domain:** dev.tronrelic.com
- **IP Address:** `<DEV_DROPLET_IP>`
- **Provider:** Digital Ocean Droplet
- **Region:** (Specify region)
- **Deployment Directory:** `/opt/tronrelic`
- **Docker Image Tags:** `:development`
- **ENV Variable:** `ENV=development`
- **CI/CD Branch:** `dev`
- **Auto-Deploy:** Yes (GitHub Actions automatically deploys on push to dev branch)

**SSH Access:**
```bash
ssh root@<DEV_DROPLET_IP>
```

**Application URLs:**
- Frontend: http://dev.tronrelic.com/
- Backend API: http://dev.tronrelic.com/api
- System Monitor: http://dev.tronrelic.com/system (requires ADMIN_API_TOKEN)

## Centralized Environment Configuration

TronRelic uses a **unified Docker deployment system** where all environments share identical container names, deployment directories, and docker-compose.yml files. Environment differentiation is controlled by a single `ENV` variable in the `.env` file.

**See [operations-docker.md](../system/operations-docker.md) for complete Docker standards documentation.**

**Key principles:**
- **Single ENV variable:** `ENV=production` or `ENV=development` controls image tags and Node.js runtime
- **Unified container names:** All environments use `tronrelic-backend`, `tronrelic-frontend`, etc. (no suffixes)
- **Unified deployment directory:** All environments deploy to `/opt/tronrelic`
- **Centralized server configuration:** Deployment scripts use `scripts/droplet-config.sh` for IP addresses

**Configuration file:** `/home/delphian/projects/tronrelic.com-beta/scripts/droplet-config.sh`

**What it provides:**
- `DROPLET_IP` - IP address of the droplet
- `DROPLET_HOST` - SSH connection string (root@IP)
- `DEPLOY_DIR` - Deployment directory (always `/opt/tronrelic`)
- `GITHUB_USERNAME` - GitHub username for container registry
- `GITHUB_REPO` - GitHub repository name

**Configured environments:**
```bash
prod  -> IP: <defined in droplet-config.sh>, ENV=production
dev   -> IP: <DEV_DROPLET_IP>, ENV=development
```

**Container names (identical for all environments):**
- `tronrelic-backend`
- `tronrelic-frontend`
- `tronrelic-mongo`
- `tronrelic-redis`

**Why this matters:**
- **Single source of truth**: One `ENV` variable controls all environment behavior
- **Eliminates duplication**: Same container names and paths across all environments
- **Prevents errors**: No environment-specific references needed in scripts
- **Simplifies maintenance**: Scripts work across all environments without modification

**Updating server information:**
When IP addresses change, update `scripts/droplet-config.sh`:
```bash
# Edit the ENVIRONMENTS associative array
declare -A ENVIRONMENTS=(
    [prod]="<NEW_PROD_IP>"
    [dev]="<NEW_DEV_IP>"
)
```

All deployment scripts will automatically use the new configuration on next run.

## SSH Authentication

TronRelic servers use **SSH key authentication only** (password authentication is disabled for security).

### SSH Key Setup

**Prerequisites:**
- SSH key pair generated on your local machine
- Public key added to droplet's `~/.ssh/authorized_keys`

**Generate SSH key (if you don't have one):**
```bash
ssh-keygen -t ed25519 -C "your_email@example.com"
# Default location: ~/.ssh/id_ed25519
```

**Test SSH connection:**
```bash
# Production
ssh root@<PROD_DROPLET_IP>

# Development
ssh root@<DEV_DROPLET_IP>

# Expected output: SSH login prompt or shell prompt
# If connection fails: Verify SSH key is authorized and firewall allows port 22
```

**Configure SSH shortcut (optional):**

Add to `~/.ssh/config`:
```
Host tronrelic-prod
    HostName <PROD_DROPLET_IP>
    User root
    IdentityFile ~/.ssh/id_ed25519

Host tronrelic-dev
    HostName <DEV_DROPLET_IP>
    User root
    IdentityFile ~/.ssh/id_ed25519
```

Then connect with:
```bash
ssh tronrelic-prod
ssh tronrelic-dev
```

### SSH Key Management for CI/CD

**GitHub Actions requires SSH private key** for automated deployment to development server.

**GitHub repository secrets required:**
- `DEV_DROPLET_HOST` = <DEV_DROPLET_IP>
- `DEV_DROPLET_USER` = root
- `DEV_DROPLET_SSH_KEY` = (full SSH private key content)

**Adding SSH key to GitHub:**
1. Navigate to repository Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Name: `DEV_DROPLET_SSH_KEY`
4. Value: Paste entire SSH private key (including `-----BEGIN OPENSSH PRIVATE KEY-----` header)
5. Save secret

**Security note:** Production server does NOT have automated SSH access from GitHub Actions. Production deployments must be triggered manually for additional safety.

## Required Credentials

### Server-Side Credentials (.env files)

Each server has an `.env` file in its deployment directory containing runtime configuration and secrets.

**Location:**
- Production: `/opt/tronrelic/.env` (with `ENV=production`)
- Development: `/opt/tronrelic/.env` (with `ENV=development`)

**Required variables:**

```bash
# Environment identifier (controls image tags and runtime)
ENV=production  # or ENV=development

# Required - API Security
ADMIN_API_TOKEN=<ADMIN_TOKEN>
# Generate with: openssl rand -hex 32
# Purpose: Authenticates requests to /system monitoring endpoint

# Required - TronGrid API Keys
TRONGRID_API_KEY=<API_KEY_1>
TRONGRID_API_KEY_2=<API_KEY_2>
TRONGRID_API_KEY_3=<API_KEY_3>
# Obtain from: https://www.trongrid.io/
# Purpose: Access TRON blockchain data (rate limit distribution)

# Required - Database Security (both environments)
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=<MONGO_PASSWORD>
# Generate with: openssl rand -hex 32
# Purpose: MongoDB authentication

REDIS_PASSWORD=<REDIS_PASSWORD>
# Generate with: openssl rand -hex 32
# Purpose: Redis authentication

# Note: Telegram bot token and webhook secret are configured via admin UI
# at /system/plugins/telegram-bot/settings, not environment variables
```

**Environment-specific URLs:**

**Production (.env):**
```bash
ENV=production
SITE_URL=https://tronrelic.com
SITE_WS=https://tronrelic.com
```

**Development (.env):**
```bash
ENV=development
SITE_URL=https://dev.tronrelic.com
SITE_WS=https://dev.tronrelic.com
```

**Note:** Frontend fetches runtime configuration from backend API. NEXT_PUBLIC_* variables are deprecated in favor of runtime config (see [system-runtime-config.md](../system/system-runtime-config.md)).

### GitHub Container Registry Authentication

**Why authentication is required:**
Docker images are stored in GitHub Container Registry (ghcr.io) as private packages. Droplets must authenticate to pull images during deployment.

**Create GitHub Personal Access Token:**
1. Navigate to GitHub Settings → Developer settings → Personal access tokens → Tokens (classic)
2. Click "Generate new token (classic)"
3. Name: "TronRelic Droplet GHCR Access"
4. Expiration: 90 days (or "No expiration" for long-term deployments)
5. Scopes: Select **read:packages** only
6. Generate token and save securely

**Authenticate droplet with GHCR:**
```bash
# Run on droplet during initial setup
echo '<GITHUB_TOKEN>' | docker login ghcr.io -u delphian --password-stdin

# Verify authentication (use correct environment tag)
docker pull ghcr.io/delphian/tronrelic/backend:production     # For production
docker pull ghcr.io/delphian/tronrelic/backend:development    # For development
```

**Security note:** GitHub Personal Access Tokens grant access to your GitHub account. Use the minimum required scope (read:packages) and rotate tokens regularly.

## DNS Configuration

**Domain provider:** (Specify registrar, e.g., Namecheap, Cloudflare, Google Domains)

**Required DNS records:**

| Record Type | Hostname | Value | TTL | Purpose |
|-------------|----------|-------|-----|---------|
| A | tronrelic.com | `<PROD_DROPLET_IP>` | 300 | Production frontend |
| A | dev.tronrelic.com | `<DEV_DROPLET_IP>` | 300 | Development frontend |

**Verify DNS propagation:**
```bash
# Production
dig +short tronrelic.com
# Expected output: <PROD_DROPLET_IP>

# Development
dig +short dev.tronrelic.com
# Expected output: <DEV_DROPLET_IP>

# If results don't match, wait 5-15 minutes for DNS propagation
```

## Firewall Configuration

Both servers use **UFW (Uncomplicated Firewall)** with these rules:

**Allowed ports:**
- **22/tcp** - SSH access
- **80/tcp** - HTTP (redirects to HTTPS in production)
- **443/tcp** - HTTPS (production only)
- **3000/tcp** - Frontend (for testing, routed via Nginx)
- **4000/tcp** - Backend API (for testing, routed via Nginx)

**View firewall status on server:**
```bash
sudo ufw status
```

**Production firewall rules:**
```
To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
3000/tcp                   ALLOW       Anywhere
4000/tcp                   ALLOW       Anywhere
```

**Note:** MongoDB (27017) and Redis (6379) are NOT exposed externally. They are only accessible via Docker network from backend container.

## SSL Certificates (Production Only)

**Production uses Let's Encrypt SSL certificates** for HTTPS encryption.

**Certificate details:**
- **Provider:** Let's Encrypt
- **Domain:** tronrelic.com
- **Location:** `/etc/letsencrypt/live/tronrelic.com/`
- **Renewal:** Automatic (certbot renew runs daily via cron)
- **Expiration:** 90 days (auto-renewed at 30 days remaining)

**View certificate status:**
```bash
# On production server
sudo certbot certificates
```

**Manual renewal (if auto-renewal fails):**
```bash
# On production server
sudo certbot renew --force-renewal
sudo systemctl reload nginx
```

**Re-run SSL setup script (if certificate is missing):**
```bash
# From local machine
./scripts/droplet-setup-ssl.sh prod tronrelic.com admin@tronrelic.com
```

## Credential Storage Best Practices

**DO:**
- Store production credentials in a secure password manager (1Password, LastPass, Bitwarden)
- Use unique, randomly generated passwords (minimum 32 characters)
- Rotate credentials quarterly or after personnel changes
- Share credentials via encrypted channels (password manager sharing, encrypted email)
- Document credential locations in team runbooks

**DON'T:**
- Commit .env files or credentials to version control
- Share credentials via unencrypted channels (Slack, email, SMS)
- Use weak or predictable passwords
- Store credentials in plain text files
- Hard-code credentials in source code

**Credential rotation checklist:**
1. Generate new credential with `openssl rand -hex 32`
2. Update .env file on server
3. Restart affected services (`docker compose restart`)
4. Update credential in password manager
5. Revoke old credential (for API tokens)
6. Verify services still function correctly

## Updating Server Information

**When server details change (IP address, domain, credentials), update these locations:**

1. **Primary: Centralized configuration** (`scripts/droplet-config.sh`)
   - Update the `ENVIRONMENTS` associative array with new IP addresses
   - All deployment scripts will automatically use the new configuration
2. **This document** (`docs/operations/operations-server-info.md`)
   - Update IP addresses in server tables and examples
3. **GitHub Actions workflows:**
   - `.github/workflows/docker-publish-prod.yml` (production builds)
   - `.github/workflows/docker-publish-dev.yml` (DEV_DROPLET_HOST secret)
4. **Nginx configuration on servers:**
   - `/etc/nginx/sites-available/tronrelic` (server_name directive)
5. **Server .env files:**
   - `/opt/tronrelic/.env` (SITE_URL, SITE_WS values)

**Note:** With the centralized `droplet-config.sh`, you no longer need to update IP addresses in individual deployment scripts. Update only the config file and documentation.

**After updates, verify deployment still works:**
```bash
# Test SSH connection
ssh root@<NEW_IP>

# Test deployment script
./scripts/droplet-update.sh prod  # or dev

# Verify application health
curl https://tronrelic.com/api/health
curl http://dev.tronrelic.com/api/health
```

## Quick Reference

**Production server access:**
```bash
ssh root@<PROD_DROPLET_IP>
cd /opt/tronrelic
```

**Development server access:**
```bash
ssh root@<DEV_DROPLET_IP>
cd /opt/tronrelic
```

**View credentials on server:**
```bash
cat .env  # View all environment variables
grep ADMIN_API_TOKEN .env  # View specific credential
```

**Test GitHub Container Registry authentication:**
```bash
docker pull ghcr.io/delphian/tronrelic/backend:production
docker pull ghcr.io/delphian/tronrelic/backend:development
```

**Check DNS resolution:**
```bash
dig +short tronrelic.com
dig +short dev.tronrelic.com
```

## Further Reading

- [operations-docker.md](../system/operations-docker.md) - Unified Docker deployment standards
- [operations-workflows.md](./operations-workflows.md) - Initial setup and update procedures
- [operations-remote-access.md](./operations-remote-access.md) - SSH usage, debugging, log inspection
- [operations.md](./operations.md) - Deployment overview and quick reference
- [system-runtime-config.md](../system/system-runtime-config.md) - Runtime configuration system
