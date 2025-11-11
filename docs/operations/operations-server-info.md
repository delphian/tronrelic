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

TronRelic maintains two deployment environment types with distinct purposes and lifecycles:

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
- **Auto-Deploy:** No (manual deployment required via `./scripts/droplet-update.sh prod`)
- **Lifespan:** Permanent (until manually destroyed)

**SSH Access:**
```bash
ssh root@<PROD_DROPLET_IP>
```

**Application URLs:**
- Frontend: https://tronrelic.com/
- Backend API: https://tronrelic.com/api
- System Monitor: https://tronrelic.com/system (requires ADMIN_API_TOKEN)

### PR Testing Environments (pr-{number}.dev-pr.tronrelic.com)

**Purpose:** Fully automated ephemeral testing environments for pull requests

- **Domain:** `pr-{number}.dev-pr.tronrelic.com` (unique subdomain per PR)
- **IP Address:** Dynamic (assigned when PR is opened, see PR comment for details)
- **Provider:** Digital Ocean Droplet
- **Region:** (Same as production)
- **Droplet Name:** `tronrelic-pr-{number}` (e.g., `tronrelic-pr-42`)
- **Deployment Directory:** `/opt/tronrelic`
- **Docker Image Tags:** `:dev-{sha}` (built from PR branch code)
- **ENV Variable:** `ENV=development`
- **CI/CD Branch:** Any branch with PR to `main`
- **Auto-Deploy:** Yes (fully automated provisioning, updates, and teardown)
- **Lifespan:** Temporary (auto-destroyed when PR closes/merges)

**SSH Access:**
```bash
# IP address provided in PR comment after provisioning
ssh root@<PR_DROPLET_IP>
```

**Application URLs:**
```
# Example for PR #42
- Frontend: https://pr-42.dev-pr.tronrelic.com/
- Backend API: https://pr-42.dev-pr.tronrelic.com/api
- System Monitor: https://pr-42.dev-pr.tronrelic.com/system
```

**Automated workflow:**
1. Opening PR to `main` triggers provisioning
2. GitHub Actions builds `:dev-{sha}` images from PR branch
3. Creates droplet `tronrelic-pr-{number}`
4. Creates DNS record via Cloudflare
5. Deploys wildcard SSL certificate (`*.dev-pr.tronrelic.com`)
6. Installs Docker, Nginx, and starts containers
7. Posts PR comment with access URLs and SSH details
8. Subsequent pushes to PR branch automatically update the same droplet
9. Closing/merging PR triggers automatic droplet and DNS cleanup

**See [operations-workflows.md](./operations-workflows.md#pr-testing-environments) for complete PR environment documentation.**

## Centralized Environment Configuration

TronRelic uses a **unified Docker deployment system** where all environments share identical container names, deployment directories, and docker-compose.yml files. Environment differentiation is controlled by a single `ENV` variable in the `.env` file.

**See [operations-docker.md](../system/operations-docker.md) for complete Docker standards documentation.**

**Key principles:**
- **Single ENV variable:** `ENV=production` or `ENV=development` controls image tags and Node.js runtime
- **Unified container names:** All environments use `tronrelic-backend`, `tronrelic-frontend`, etc. (no suffixes)
- **Unified deployment directory:** All environments deploy to `/opt/tronrelic`
- **Centralized server configuration:** Production deployment uses `scripts/droplet-config.sh` for IP address

**Configuration file (production only):** `scripts/droplet-config.sh` (repository root)

**What it provides:**
- `DROPLET_IP` - IP address of the production droplet
- `DROPLET_HOST` - SSH connection string (root@IP)
- `DEPLOY_DIR` - Deployment directory (always `/opt/tronrelic`)
- `GITHUB_USERNAME` - GitHub username for container registry
- `GITHUB_REPO` - GitHub repository name

**Configured environments:**
```bash
prod  -> IP: <defined in droplet-config.sh>, ENV=production
```

**PR testing environments:**
- Fully managed by GitHub Actions (no manual configuration needed)
- IP addresses dynamically assigned during provisioning
- Configuration stored in PR comment after deployment

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

**Updating production server IP:**
When the production IP address changes, update `scripts/droplet-config.sh`:
```bash
# Edit the ENVIRONMENTS associative array
declare -A ENVIRONMENTS=(
    [prod]="<NEW_PROD_IP>"
)
```

All deployment scripts will automatically use the new configuration on next run.

**Note:** PR testing environments are fully automated and don't require manual IP configuration.

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

# PR testing environment (IP provided in PR comment)
ssh root@<PR_DROPLET_IP>

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
```

Then connect with:
```bash
ssh tronrelic-prod
```

**Note:** PR testing environments use dynamic IPs - check the PR comment for the exact IP address.

### SSH Key Management for CI/CD

**Production deployments:**
- Manual execution required using `./scripts/droplet-update.sh prod`
- No automated deployment from GitHub Actions

**PR testing environments:**
- Fully automated provisioning and deployment via GitHub Actions
- SSH private key stored in GitHub repository secret `DO_SSH_PRIVATE_KEY`
- Public key must be added to Digital Ocean account SSH keys
- GitHub Actions uses SSH to install Docker, deploy configurations, and start containers

**Security note:** The SSH key used by GitHub Actions has access to provision and configure droplets. Rotate this key quarterly and ensure it's stored only in GitHub repository secrets.

## Required Credentials

### Server-Side Credentials (.env files)

Each server has an `.env` file in its deployment directory containing runtime configuration and secrets.

**Location:**
- Production: `/opt/tronrelic/.env` (with `ENV=production`) - Manually created during initial setup
- PR Testing: `/opt/tronrelic/.env` (with `ENV=development`) - Automatically generated by GitHub Actions

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

**PR Testing (.env - automatically generated by GitHub Actions):**
```bash
ENV=development
SITE_URL=https://pr-42.dev-pr.tronrelic.com  # Unique subdomain per PR
SITE_WS=https://pr-42.dev-pr.tronrelic.com
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
echo '<GITHUB_TOKEN>' | docker login ghcr.io -u <GITHUB_USERNAME> --password-stdin

# Verify authentication (use correct environment tag)
docker pull ghcr.io/<GITHUB_USERNAME>/<GITHUB_REPO>/backend:production     # For production
docker pull ghcr.io/<GITHUB_USERNAME>/<GITHUB_REPO>/backend:production     # Universal tag for all environments
```

**Security note:** GitHub Personal Access Tokens grant access to your GitHub account. Use the minimum required scope (read:packages) and rotate tokens regularly.

## DNS Configuration

**Domain provider:** Cloudflare (for automated PR testing DNS management)

**Required DNS records:**

| Record Type | Hostname | Value | TTL | Purpose | Management |
|-------------|----------|-------|-----|---------|------------|
| A | tronrelic.com | `<PROD_DROPLET_IP>` | Auto | Production frontend | Manual (Cloudflare dashboard) |
| A | pr-{number}.dev-pr.tronrelic.com | Dynamic | Auto | PR testing environments | Automated (GitHub Actions) |

**Wildcard SSL certificate:**
- A single wildcard certificate (`*.dev-pr.tronrelic.com`) covers all PR testing subdomains
- Certificate deployed to each PR droplet during provisioning
- No per-PR certificate generation needed

**Verify DNS propagation:**
```bash
# Production
dig +short tronrelic.com
# Expected output: <PROD_DROPLET_IP>

# PR testing environment (example for PR #42)
dig +short pr-42.dev-pr.tronrelic.com
# Expected output: <PR_DROPLET_IP>

# If results don't match, wait 5-15 minutes for DNS propagation
```

**See [operations-cloudflare-setup.md](./operations-cloudflare-setup.md) for complete Cloudflare DNS automation documentation.**

## Firewall Configuration

All environments use **UFW (Uncomplicated Firewall)** for host-level protection. However, **Docker bypasses UFW** by manipulating iptables directly, so port binding configuration in `docker-compose.yml` is critical for security.

### Exposed Ports

**Externally accessible (via UFW and Nginx):**
- **22/tcp** - SSH access (UFW managed)
- **80/tcp** - HTTP (UFW managed, redirects to HTTPS)
- **443/tcp** - HTTPS (UFW managed, Nginx reverse proxy)

**Localhost only (Docker bound to 127.0.0.1):**
- **3000/tcp** - Frontend (Nginx proxies via localhost)
- **4000/tcp** - Backend API (Nginx proxies via localhost)

**Internal only (no port binding, Docker network only):**
- **27017/tcp** - MongoDB (accessible only via Docker network)
- **6379/tcp** - Redis (accessible only via Docker network)

### Security Architecture

**Why Docker bypasses UFW:**
Docker creates iptables rules that take precedence over UFW rules. Even if you block a port in UFW, Docker-published ports remain accessible.

**Our security approach:**
1. **Databases:** No port binding at all - accessible only via Docker network
2. **Applications:** Bind to `127.0.0.1:port` - accessible to Nginx but not externally
3. **Nginx:** Only component exposed externally (ports 80/443)

**Verify secure configuration:**
```bash
# Check Docker port bindings (should show 127.0.0.1 for apps, nothing for databases)
docker compose ps --format "table {{.Name}}\t{{.Ports}}"

# Expected output:
# tronrelic-backend     127.0.0.1:4000->4000/tcp
# tronrelic-frontend    127.0.0.1:3000->3000/tcp
# tronrelic-mongo       (empty - no ports exposed)
# tronrelic-redis       (empty - no ports exposed)
```

**View firewall status on server:**
```bash
sudo ufw status
```

**Standard firewall rules:**
```
To                         Action      From
--                         ------      ----
22/tcp                     ALLOW       Anywhere
80/tcp                     ALLOW       Anywhere
443/tcp                    ALLOW       Anywhere
```

**Note:** Ports 3000 and 4000 are NOT in UFW rules because they're bound to localhost in docker-compose.yml. UFW rules for these ports would be ineffective anyway since Docker bypasses UFW.

**Note:** MongoDB (27017) and Redis (6379) are NOT exposed externally. They are only accessible via Docker network from backend container.

### Debugging Access

Since application ports are bound to localhost only, use these methods for debugging:

**SSH port forwarding (recommended for remote debugging):**
```bash
# Forward backend and frontend to your local machine
ssh -L 3000:localhost:3000 -L 4000:localhost:4000 root@<droplet-ip>

# Now access from your browser:
# http://localhost:3000 (frontend)
# http://localhost:4000/api/health (backend)
```

**Direct container access (for database debugging):**
```bash
# MongoDB shell
ssh root@<droplet-ip> "docker exec -it tronrelic-mongo mongosh"

# Redis CLI
ssh root@<droplet-ip> "docker exec -it tronrelic-redis redis-cli -a \$REDIS_PASSWORD"
```

**Container logs:**
```bash
# View live logs
ssh root@<droplet-ip> "cd /opt/tronrelic && docker compose logs -f backend frontend"
```

**PR testing environments:**
- Firewall rules automatically configured during provisioning
- Same secure port binding as production (127.0.0.1)

## SSL Certificates

### Production (tronrelic.com)

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

### PR Testing Environments (*.dev-pr.tronrelic.com)

**PR testing environments use a wildcard SSL certificate** deployed during automated provisioning.

**Certificate details:**
- **Provider:** Let's Encrypt
- **Domain:** `*.dev-pr.tronrelic.com` (wildcard certificate)
- **Location (on PR droplets):** `/etc/nginx/ssl/wildcard.crt` and `/etc/nginx/ssl/wildcard.key`
- **Deployment:** Automatically deployed by GitHub Actions during provisioning
- **Storage:** Base64-encoded in GitHub repository secrets
- **Renewal:** Manual renewal required, then update GitHub secrets

**Renew wildcard certificate (when needed):**
1. Generate new wildcard certificate using Cloudflare DNS challenge
2. Base64-encode certificate and key files
3. Update GitHub repository secrets:
   - `WILDCARD_SSL_CERT` - Base64-encoded certificate
   - `WILDCARD_SSL_KEY` - Base64-encoded private key
4. New PRs automatically receive updated certificate

**See [operations-cloudflare-setup.md](./operations-cloudflare-setup.md) for complete wildcard SSL certificate setup and renewal procedures.**

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

### Production Server Changes

**When production server details change (IP address, domain, credentials), update these locations:**

1. **Primary: Centralized configuration** (`scripts/droplet-config.sh`)
   - Update the `ENVIRONMENTS` associative array with new production IP
   - All deployment scripts will automatically use the new configuration
2. **This document** (`docs/operations/operations-server-info.md`)
   - Update IP addresses in server tables and examples
3. **GitHub Actions workflows:**
   - `.github/workflows/prod-publish.yml` (builds production images)
4. **Nginx configuration on production server:**
   - `/etc/nginx/sites-available/tronrelic` (server_name directive)
5. **Production .env file:**
   - `/opt/tronrelic/.env` (SITE_URL, SITE_WS values)
6. **DNS records:**
   - Update A record for tronrelic.com in Cloudflare dashboard

**After updates, verify deployment still works:**
```bash
# Test SSH connection
ssh root@<NEW_PROD_IP>

# Test deployment script
./scripts/droplet-update.sh prod

# Verify application health
curl https://tronrelic.com/api/health
```

### PR Testing Environment Changes

**PR testing environments are fully automated and require no manual server updates.**

**If GitHub repository secrets change:**
1. Update secrets in GitHub repository settings
2. Existing PR droplets continue using old secrets
3. New PR droplets automatically receive updated secrets

**Required secrets for PR automation:**
- `DO_API_TOKEN` - Digital Ocean API token for droplet provisioning
- `DO_SSH_KEY_FINGERPRINT` - SSH key fingerprint for droplet access
- `DO_SSH_PRIVATE_KEY` - SSH private key for remote commands
- `CLOUDFLARE_API_TOKEN` - Cloudflare API token for DNS management
- `CLOUDFLARE_ZONE_ID` - Cloudflare zone ID for tronrelic.com
- `WILDCARD_SSL_CERT` - Base64-encoded wildcard SSL certificate
- `WILDCARD_SSL_KEY` - Base64-encoded wildcard SSL private key
- `ADMIN_API_TOKEN` - Admin token for system monitoring
- `TRONGRID_API_KEY`, `TRONGRID_API_KEY_2`, `TRONGRID_API_KEY_3` - TronGrid API keys

**Note:** With centralized configuration and automated PR provisioning, most infrastructure updates require no code changes.

## Quick Reference

**Production server access:**
```bash
ssh root@<PROD_DROPLET_IP>
cd /opt/tronrelic
```

**PR testing environment access:**
```bash
# IP provided in PR comment after provisioning
ssh root@<PR_DROPLET_IP>
cd /opt/tronrelic
```

**View credentials on server:**
```bash
cat .env  # View all environment variables
grep ADMIN_API_TOKEN .env  # View specific credential
grep ENV .env  # Check environment type
```

**Test GitHub Container Registry authentication:**
```bash
docker pull ghcr.io/delphian/tronrelic/backend:production
```

**Check DNS resolution:**
```bash
# Production
dig +short tronrelic.com

# PR testing environment (example for PR #42)
dig +short pr-42.dev-pr.tronrelic.com
```

**Common operations:**
```bash
# Production deployment
./scripts/droplet-update.sh prod

# View container status (on any server)
docker compose ps

# View logs (on any server)
docker compose logs -f backend
docker compose logs -f frontend

# Health check
curl https://tronrelic.com/api/health
curl https://pr-42.dev-pr.tronrelic.com/api/health
```

## Further Reading

- [operations-docker.md](../system/operations-docker.md) - Unified Docker deployment standards
- [operations-workflows.md](./operations-workflows.md) - Initial setup and update procedures
- [operations-cloudflare-setup.md](./operations-cloudflare-setup.md) - Cloudflare DNS automation and wildcard SSL certificate setup
- [operations-remote-access.md](./operations-remote-access.md) - SSH usage, debugging, log inspection
- [operations.md](./operations.md) - Deployment overview and quick reference
- [system-runtime-config.md](../system/system-runtime-config.md) - Runtime configuration system
