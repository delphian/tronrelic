# Deployment Workflows

This document describes the complete procedures for deploying TronRelic to production, from initial server setup to routine updates.

## Security Note: IP Address Placeholders

**For security reasons, actual IP addresses are replaced with placeholders in this documentation.**

**Automated agents can find actual IP addresses in:**
- **Local .env file:** Variable `PROD_DROPLET_IP` (used by deployment scripts)
- **Deployment config:** `scripts/droplet-config.sh` (ENVIRONMENTS array, sourced by scripts)
- **GitHub Actions workflow summaries:** Check recent workflow runs for actual IPs used
- **PR comments:** GitHub Actions posts droplet IPs in PR comments for PR environments
- **Digital Ocean CLI:** `doctl compute droplet list` shows all active droplets and IPs

**Placeholders used in this document:**
- `<PROD_DROPLET_IP>` - Production server IP (from .env: `PROD_DROPLET_IP`)
- `<PR_DROPLET_IP>` - Example IP for PR testing environments (see PR comments)

## Why This Matters

**Risk of ad-hoc deployments:**
- Manual errors during setup cause configuration drift between environments
- Missing steps leave servers in partially configured states
- Inconsistent update procedures introduce bugs and downtime
- Lack of automation slows release velocity and increases human error

**Benefits of standardized workflows:**
- Reproducible deployments ensure environment consistency
- Automated CI/CD reduces manual intervention and errors
- Documented procedures enable any team member to deploy
- Scripted workflows capture institutional knowledge

## Deployment Strategies

TronRelic supports three deployment methods with different use cases:

| Method | Use Case | Automation | Safety |
|--------|----------|------------|--------|
| **Initial Setup Scripts** | New server from scratch | Semi-automated | Manual approval |
| **Manual Update Scripts** | Routine updates, hotfixes | Manual execution | Full control |
| **CI/CD Image Builds** | Automated image building | Fully automated | Both environments |

**Recommendation:**
- Use **initial setup scripts** when provisioning a new production server
- Use **manual update scripts** for production deployments
- **CI/CD builds Docker images** automatically but does not deploy them to servers
- **PR testing environments** are fully automated (no manual deployment needed)

## Initial Server Setup

These workflows take a fresh Ubuntu 22.04 droplet and configure it to run TronRelic with Docker, Nginx, and all required dependencies.

### Production Setup (tronrelic.com)

**Prerequisites:**
- Fresh Ubuntu 22.04+ Digital Ocean droplet
- Root SSH access configured (SSH key added during droplet creation)
- Domain DNS A record pointing to droplet IP
- GitHub Personal Access Token with `read:packages` scope
- Three TronGrid API keys from https://www.trongrid.io/

**Run initial setup script:**
```bash
# From your local machine
./scripts/droplet-deploy.sh <env>

# Example (production):
./scripts/droplet-deploy.sh prod

# Note: PR testing environments are automatically provisioned via GitHub Actions
# No manual deployment needed for PR testing
```

**What the script does:**
1. **Verifies SSH connection** to droplet
2. **Installs Docker and Docker Compose** from official Docker repository
3. **Installs and configures Nginx** reverse proxy
4. **Configures UFW firewall** (allows SSH, HTTP, HTTPS)
5. **Authenticates with GitHub Container Registry** using your personal access token
6. **Creates deployment directory** at `/opt/tronrelic`
7. **Generates secure credentials** (ADMIN_API_TOKEN, MONGO_PASSWORD, REDIS_PASSWORD)
8. **Creates production .env file** with your TronGrid API keys and generated secrets (sets `ENV=production`)
9. **Copies unified docker-compose.yml** to deployment directory
10. **Pulls Docker images** from ghcr.io/delphian/tronrelic (`:production` tags)
11. **Starts all containers** (MongoDB, Redis, backend, frontend)
12. **Verifies deployment** via health checks

**Expected output:**
```
DEPLOYMENT COMPLETE!

Application URLs (via Nginx on port 80):
  Frontend:     http://<DROPLET_IP>/
  Backend API:  http://<DROPLET_IP>/api
  System:       http://<DROPLET_IP>/system

Admin Credentials:
  ADMIN_API_TOKEN: <generated-token>

Next Steps:
  1. Access the frontend at http://<DROPLET_IP>/
  2. Test the system monitor at http://<DROPLET_IP>/system
  3. Set up SSL/HTTPS with: ./scripts/droplet-setup-ssl.sh prod tronrelic.com admin@example.com
```

**Save the generated credentials immediately!** Store them in a password manager before proceeding.

**Setup SSL/HTTPS (required for production):**
```bash
# From your local machine
./scripts/droplet-setup-ssl.sh <env> <domain> <email>

# Example (production):
./scripts/droplet-setup-ssl.sh prod tronrelic.com admin@tronrelic.com

# Note: PR testing environments use wildcard SSL certificate (*.dev-pr.tronrelic.com)
# SSL is configured automatically via GitHub Actions workflow
```

**What the SSL script does:**
1. **Verifies DNS resolution** (ensures domain points to droplet IP)
2. **Installs Certbot** and Nginx plugin
3. **Obtains SSL certificate** from Let's Encrypt
4. **Configures Nginx** with HTTPS, security headers, and HTTP→HTTPS redirect
5. **Updates .env file** to use HTTPS URLs
6. **Restarts frontend container** to apply new URLs
7. **Tests automatic renewal** (certificates auto-renew every 60 days)

**Verify production deployment:**
```bash
# Test HTTPS (should work)
curl https://tronrelic.com/api/health

# Test HTTP (should redirect to HTTPS)
curl -I http://tronrelic.com/
# Expected: HTTP/1.1 301 Moved Permanently
```

## Manual Deployment Updates

Use these scripts to manually update running deployments with the latest Docker images.

### Update Production

**When to use:**
- Deploy new features after testing in development
- Apply hotfixes to production
- Manually trigger deployment after pushing to `main` branch

**Prerequisites:**
- Latest Docker images pushed to ghcr.io with `:production` tag
- GitHub Actions workflow completed successfully (check Actions tab)

**Run update script:**
```bash
# From your local machine
./scripts/droplet-update.sh prod

# Or skip confirmation prompt
./scripts/droplet-update.sh prod --force
```

**What the script does:**
1. **Verifies SSH connection** to production server
2. **Shows current container status** (docker compose ps)
3. **Pulls latest images** from ghcr.io (`:production` tags)
4. **Restarts containers** with new images using rolling restart strategy (docker compose up -d)
5. **Waits for startup** (15 seconds)
6. **Checks container health** (docker compose ps)
7. **Verifies backend health** (curl http://localhost:4000/api/health)
8. **Verifies frontend health** (curl http://localhost:3000/)

**Production restart strategy:**
Production uses `docker compose up -d` which performs a rolling restart to minimize downtime. This keeps existing containers running while starting new ones, ensuring continuous service availability.

**Expected output:**
```
Deployment complete!

Application URLs:
  Frontend: http://<PROD_DROPLET_IP>:3000
  Backend:  http://<PROD_DROPLET_IP>:4000/api
  System:   http://<PROD_DROPLET_IP>:3000/system

View logs with:
  ssh root@<PROD_DROPLET_IP> 'cd /opt/tronrelic && docker compose logs -f'
```

**Verify deployment:**
```bash
# Test HTTPS endpoints (public-facing via Nginx)
curl https://tronrelic.com/api/health
curl -I https://tronrelic.com/

# View logs
ssh root@<PROD_DROPLET_IP> 'cd /opt/tronrelic && docker compose logs --tail=50 backend'
```

## CI/CD Image Building

TronRelic uses GitHub Actions for continuous integration and automated Docker image builds. All images are tagged as `:production` regardless of target environment. Deployment to servers is always manual.

**Workflow file:** `.github/workflows/prod-publish.yml`

**Triggers:**
- Push to `main` branch only (production releases)

**Pipeline stages:**

1. **Run Tests:**
   - Runs unit and integration tests via `.github/workflows/test.yml`
   - Tests must pass before images are built

2. **Build and Push (only on successful tests):**
   - Log in to GitHub Container Registry (ghcr.io)
   - Build and tag backend image (`:production` and `:production-$COMMIT_SHA`)
   - Push backend image to ghcr.io
   - Build and tag frontend image (`:production` and `:production-$COMMIT_SHA`)
   - Push frontend image to ghcr.io

3. **Manual Deployment Required:**
   - GitHub Actions builds images but does NOT deploy them
   - Run deployment script manually after verifying images:
     - `./scripts/droplet-update.sh prod`

**Why manual deployment?**
- Extra safety for production changes
- Allows verification of images before deployment
- Enables scheduled deployment windows (maintenance windows)
- Prevents accidental deployments

**Deploy after successful build:**
```bash
# Production (after push to main):
./scripts/droplet-update.sh prod

# View deployment logs
ssh root@<PROD_DROPLET_IP> 'cd /opt/tronrelic && docker compose logs --tail=100 -f'
```

**Why single :production tag?**
- Simplifies deployment (no confusion about which tag to use)
- ENV variable in server .env file controls runtime behavior
- Simplifies docker-compose.yml (no variable substitution needed)

## PR Testing Environments

TronRelic automatically creates persistent testing droplets for each pull request to the `main` branch. Each PR gets its own subdomain with trusted HTTPS certificates, allowing production-like testing without browser warnings or SSL configuration delays.

**Workflow files:**
- `.github/workflows/pr-environment.yml` - Creates and updates PR droplet
- `.github/workflows/pr-teardown.yml` - Destroys droplet and cleans up DNS on PR close/merge

**Triggers:**
- **Automatic creation:** Opening PR to `main` branch creates droplet
- **Automatic cleanup:** Closing or merging PR destroys droplet and removes DNS record

**Key features:**
- Unique subdomain for each PR: `pr-{number}.dev-pr.tronrelic.com`
- Wildcard SSL certificate (no browser warnings)
- Nginx reverse proxy (production-like configuration)
- Dynamic DNS via Cloudflare API
- No reserved IP address required
- Unlimited concurrent PRs without rate limits

### How PR Testing Environments Work

**On PR creation (first time):**

1. **Build PR branch images:**
   - Build backend and frontend from PR branch code
   - Tag as `dev-{short-sha}` (e.g., `dev-a1b2c3d`)
   - Push to GitHub Container Registry

2. **Create testing droplet:**
   - Create droplet named `tronrelic-pr-{number}` (e.g., `tronrelic-pr-42`)
   - Droplet size: `s-2vcpu-4gb-amd` (2 vCPU, 4GB RAM)
   - Region: Singapore (`sgp1`)
   - OS: Ubuntu 25.04

3. **Configure DNS:**
   - Create Cloudflare DNS A record: `pr-{number}.dev-pr.tronrelic.com` → droplet IP
   - Wait 30 seconds for DNS propagation

4. **Provision environment:**
   - Install Docker and Docker Compose
   - Install Nginx
   - Deploy wildcard SSL certificate from GitHub secrets
   - Configure Nginx with HTTPS and reverse proxy
   - Copy docker-compose.yml to `/opt/tronrelic`
   - Create .env with `ENV=development` and HTTPS URLs
   - Pull PR branch images from GHCR
   - Start all containers (MongoDB, Redis, backend, frontend)
   - Run health checks via HTTPS

5. **Post comment on PR:**
   - PR domain (e.g., `pr-42.dev-pr.tronrelic.com`)
   - Droplet IP address and SSH access
   - Application URLs (all HTTPS)
   - Docker image tags used
   - Setup status checklist

**On PR close or merge:**

1. `.github/workflows/pr-teardown.yml` triggers
2. Delete Cloudflare DNS A record for `pr-{number}.dev-pr.tronrelic.com`
3. Destroy droplet `tronrelic-pr-{number}`
4. All data, containers, and DNS records removed

### Accessing a PR Testing Environment

After opening a PR to the `main` branch, find the environment details in the PR comment posted by GitHub Actions:

**Example PR comment:**
```
✅ PR Environment provisioned for PR #42

⚠️ This droplet will auto-destroy when the PR is closed or merged

Droplet Information:
- Name: tronrelic-pr-42
- Domain: pr-42.dev-pr.tronrelic.com
- IP Address: <PR_DROPLET_IP>
- Lifespan: Until PR #42 is closed/merged

Docker Images:
- Backend: ghcr.io/delphian/tronrelic/backend:dev-a1b2c3d
- Frontend: ghcr.io/delphian/tronrelic/frontend:dev-a1b2c3d

SSH Access:
ssh root@<PR_DROPLET_IP>

Setup Status:
- ✅ Ubuntu 25.04 droplet created
- ✅ Cloudflare DNS record created (pr-42.dev-pr.tronrelic.com -> <PR_DROPLET_IP>)
- ✅ Wildcard SSL certificate deployed
- ✅ Nginx reverse proxy configured with HTTPS
- ✅ Docker and docker-compose installed
- ✅ Deployment directory created (/opt/tronrelic)
- ✅ Docker images pulled and containers started
- ✅ Health checks passed

Access Application:
- Frontend: https://pr-42.dev-pr.tronrelic.com/
- Backend API: https://pr-42.dev-pr.tronrelic.com/api
- System Monitor: https://pr-42.dev-pr.tronrelic.com/system

Note:
- Uses trusted wildcard SSL certificate (no browser warnings!)
- Traffic routed through Nginx reverse proxy (identical to production)
- Containers may take 1-2 minutes to fully initialize
- DNS record will be cleaned up when PR is closed
```

**Connect to PR droplet:**
```bash
# SSH to PR droplet (use IP from PR comment)
ssh root@<DROPLET_IP>

# View container status
cd /opt/tronrelic
docker compose ps

# View logs
docker compose logs -f backend
docker compose logs -f frontend

# Test backend health (via HTTPS)
curl https://pr-42.dev-pr.tronrelic.com/api/health

# Test frontend (via HTTPS)
curl https://pr-42.dev-pr.tronrelic.com/

# Check Nginx configuration
nginx -t
systemctl status nginx

# Check .env configuration
cat /opt/tronrelic/.env
```

### Cost and Resource Usage

**Per PR environment:**
- Droplet cost: $0.033/hour
- If PR open for 1 day: $0.033 × 24 = **$0.79**
- If PR open for 1 week: $0.033 × 168 = **$5.54**
- If PR open for 1 month: $0.033 × 720 = **$23.76**

**Cloudflare DNS and SSL:**
- DNS management: **$0/month** (free tier)
- API access: **$0/month** (included)
- Wildcard SSL certificate: **$0** (Let's Encrypt)

**Cost comparison to old approach:**
- Old: Reserved static IP ($4-6/month) + self-signed SSL or no SSL for dynamic IPs
- New: Dynamic IPs + Cloudflare DNS ($0/month) + wildcard SSL ($0)
- **Savings: $4-6/month** while improving security and consistency

**Best practices to minimize costs:**
- Close or merge PRs promptly after testing
- Don't leave abandoned PRs open for extended periods

**Resource specifications:**
- Droplet size: `s-2vcpu-4gb-amd` (2 vCPU, 4GB RAM)
- Region: Singapore (`sgp1`)
- OS: Ubuntu 25.04

### Required GitHub Secrets

PR environments require the following GitHub secrets to be configured:

| Secret Name | Description | How to Obtain | Required |
|------------|-------------|---------------|----------|
| `DO_API_TOKEN` | Digital Ocean API token | DO Dashboard → API → Generate New Token | ✅ Yes |
| `DO_SSH_KEY_FINGERPRINT` | SSH key fingerprint for droplet access | `ssh-keygen -lf ~/.ssh/id_rsa.pub` | ✅ Yes |
| `DO_SSH_PRIVATE_KEY` | SSH private key for provisioning | `cat ~/.ssh/id_rsa` | ✅ Yes |
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token with DNS edit permissions | See [Cloudflare Setup Guide](./operations-cloudflare-setup.md) | ✅ Yes |
| `CLOUDFLARE_ZONE_ID` | Zone ID for tronrelic.com domain | Cloudflare Dashboard → Domain → Zone ID | ✅ Yes |
| `WILDCARD_SSL_CERT` | Base64-encoded wildcard certificate | See [Cloudflare Setup Guide](./operations-cloudflare-setup.md) | ✅ Yes |
| `WILDCARD_SSL_KEY` | Base64-encoded wildcard private key | See [Cloudflare Setup Guide](./operations-cloudflare-setup.md) | ✅ Yes |
| `ADMIN_API_TOKEN` | Admin API token for testing | `openssl rand -hex 32` | ✅ Yes |
| `TRONGRID_API_KEY` | TronGrid API key #1 | https://www.trongrid.io/ | ✅ Yes |
| `TRONGRID_API_KEY_2` | TronGrid API key #2 | https://www.trongrid.io/ | ✅ Yes |
| `TRONGRID_API_KEY_3` | TronGrid API key #3 | https://www.trongrid.io/ | ✅ Yes |

**See also:** [Cloudflare DNS and Wildcard SSL Setup Guide](./operations-cloudflare-setup.md) for detailed setup instructions.

### Manual Cleanup (Optional)

While cleanup runs automatically when PRs close, you can manually destroy droplets and clean up DNS:

**List PR droplets:**
```bash
doctl compute droplet list | grep tronrelic-pr-
```

**Manually destroy a specific PR droplet:**
```bash
# By name
doctl compute droplet delete tronrelic-pr-42 --force

# Or by ID
doctl compute droplet delete <DROPLET_ID> --force
```

**Manually delete DNS record:**
```bash
export CLOUDFLARE_API_TOKEN="your-token"
export CLOUDFLARE_ZONE_ID="your-zone-id"
./scripts/cloudflare-dns-delete.sh pr-42
```

**Trigger teardown workflow manually:**
1. Navigate to **Actions** tab → **Teardown PR Environment**
2. Click **Run workflow** button
3. Select branch (usually `main`)
4. Click **Run workflow**

### Troubleshooting PR Environments

**Workflow fails to create droplet:**
- Check Digital Ocean API token is valid in GitHub secrets
- Verify droplet quota not exceeded in Digital Ocean account
- Review workflow logs for specific error messages
- Check SSH key fingerprint matches actual key in DO account

**DNS record creation fails:**
- Verify `CLOUDFLARE_API_TOKEN` is valid in GitHub secrets
- Check `CLOUDFLARE_ZONE_ID` matches your domain
- Ensure API token has DNS edit permissions
- Review Cloudflare API logs in workflow output

**Cannot access PR environment after creation:**
- Wait 1-2 minutes for containers and DNS to fully propagate
- Check PR comment for correct domain and IP
- Test DNS resolution: `dig pr-{number}.dev-pr.tronrelic.com`
- Verify HTTPS works: `curl https://pr-{number}.dev-pr.tronrelic.com/api/health`
- SSH to droplet and check Nginx: `systemctl status nginx`
- Check container status: `docker compose ps`

**Certificate warnings in browser:**
- Verify wildcard certificate deployed: `ls -la /etc/nginx/ssl/`
- Check certificate expiration: `openssl x509 -enddate -noout -in /etc/nginx/ssl/wildcard.crt`
- Test Nginx configuration: `nginx -t`
- Check Nginx error logs: `tail -100 /var/log/nginx/error.log`
- Verify GitHub secret `WILDCARD_SSL_CERT` is base64-encoded certificate
- Restart Nginx: `systemctl restart nginx`

**Images fail to build:**
- Review build logs in GitHub Actions workflow
- Check for TypeScript compilation errors in PR branch
- Verify package dependencies are installable
- Ensure Docker build context isn't too large
- Check PR comment for latest update timestamp
- Review workflow logs to see if update step executed
- Verify IMAGE_TAG was updated in .env: `ssh root@<IP> 'grep IMAGE_TAG /opt/tronrelic/.env'`
- Manually trigger rebuild by closing and reopening PR (if needed)

**Droplet not destroyed after PR close:**
- Check **PR Environment Teardown** workflow for errors
- Manually trigger teardown workflow if needed
- Manually destroy droplet: `doctl compute droplet delete tronrelic-pr-<NUMBER> --force`

**Health checks fail:**
- SSH to droplet: `ssh root@<DROPLET_IP>`
- Check container logs: `cd /opt/tronrelic && docker compose logs`
- Verify .env file created: `cat /opt/tronrelic/.env`
- Check container status: `docker compose ps`
- Test direct container access: `curl http://localhost:4000/api/health`
- Restart containers if needed: `docker compose restart`
- Check for port conflicts: `netstat -tlnp | grep -E '3000|4000'`

## Environment-Specific Configuration

TronRelic uses a **unified deployment system** where all environments share the same docker-compose.yml and container names. Environment differentiation is controlled entirely by the `.env` file.

**See [operations-docker.md](../system/operations-docker.md) for complete Docker standards documentation.**

### Unified docker-compose.yml (all environments)

All servers use the **same docker-compose.yml** located at `/opt/tronrelic/docker-compose.yml`:

```yaml
services:
  backend:
    image: ghcr.io/delphian/tronrelic/backend:production
    container_name: tronrelic-backend
    environment:
      - NODE_ENV=${ENV}

  frontend:
    image: ghcr.io/delphian/tronrelic/frontend:production
    container_name: tronrelic-frontend
    environment:
      - NODE_ENV=${ENV}

  mongodb:
    container_name: tronrelic-mongo
    command: ["mongod", "--auth"]

  redis:
    container_name: tronrelic-redis
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]
```

**Key principle:** All environments use `:production` Docker images. The `ENV` variable determines runtime Node.js environment (development or production) only.

### Production Environment

**Configuration file:** `/opt/tronrelic/.env`

**Production-specific values:**
```bash
# Environment identifier (controls image tags and runtime)
ENV=production

# Site configuration
SITE_URL=https://tronrelic.com
SITE_WS=https://tronrelic.com
SITE_BACKEND=http://backend:4000

# Database authentication
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=<secure-password>
REDIS_PASSWORD=<secure-password>

# Database connections (auto-configured in docker-compose.yml)
MONGODB_URI=mongodb://admin:<password>@mongodb:27017/tronrelic?authSource=admin
REDIS_URL=redis://:<password>@redis:6379

# Feature flags
ENABLE_SCHEDULER=true
ENABLE_WEBSOCKETS=true

# API keys
ADMIN_API_TOKEN=<secure-token>
TRONGRID_API_KEY=<key1>
TRONGRID_API_KEY_2=<key2>
TRONGRID_API_KEY_3=<key3>
```

**Docker behavior with `ENV=production`:**
- Pulls `ghcr.io/delphian/tronrelic/backend:production`
- Pulls `ghcr.io/delphian/tronrelic/frontend:production`
- Sets `NODE_ENV=production` in containers
- Uses production-optimized frontend build

### PR Testing Environments

**Provisioning:** Fully automated via GitHub Actions (`.github/workflows/pr-environment.yml`)

**Configuration:** Automatically created when PR is opened to `main` branch

**Environment values (auto-generated):**
- `ENV=development` - Uses development runtime mode
- `SITE_URL=https://pr-{number}.dev-pr.tronrelic.com` - Unique subdomain per PR
- `SITE_WS=https://pr-{number}.dev-pr.tronrelic.com` - WebSocket URL
- `SITE_BACKEND=http://backend:4000` - Internal Docker network
- Secure credentials auto-generated with `openssl rand -hex 32`
- TronGrid API keys from GitHub Secrets

**Docker behavior with `ENV=development`:**
- Pulls `ghcr.io/delphian/tronrelic/backend:dev-{sha}` - Branch-specific images
- Pulls `ghcr.io/delphian/tronrelic/frontend:dev-{sha}` - Branch-specific images
- Sets `NODE_ENV=development` in containers
- Uses development-optimized frontend build

**Lifecycle:**
- Created automatically when PR opened
- Updated automatically on push to PR branch
- Destroyed automatically when PR closed/merged

**See:** [operations.md - PR Testing Environments](./operations.md#pr-testing-environments) for complete details

### Container Names (identical for all environments)

All environments use the **same container names** (no `-prod` or `-dev` suffixes):

| Service | Container Name |
|---------|----------------|
| Backend | `tronrelic-backend` |
| Frontend | `tronrelic-frontend` |
| MongoDB | `tronrelic-mongo` |
| Redis | `tronrelic-redis` |

**Benefits:**
- Scripts work across all environments without modification
- Consistent monitoring and debugging commands
- No environment-specific container references needed
- Simplified deployment procedures

## Deployment Rollback

**If a deployment introduces bugs or breaks production**, rollback to the previous working version.

### Rollback by Image Tag

**Note:** All environments use `:production` tags. For rollback to specific commits, use SHA-tagged images like `:production-<commit-sha>` in docker-compose.yml.

```bash
# SSH to server
ssh root@<DROPLET_IP>
cd /opt/tronrelic

# List available image tags on GitHub Container Registry
# Visit: https://github.com/delphian/tronrelic/pkgs/container/tronrelic%2Fbackend

# Edit docker-compose.yml to use specific commit SHA
nano docker-compose.yml

# Change:
#   image: ghcr.io/delphian/tronrelic/backend:production
# To:
#   image: ghcr.io/delphian/tronrelic/backend:production-<COMMIT_SHA>

# Restart containers with old image
docker compose down
docker compose up -d

# Verify rollback worked
docker compose ps
curl http://localhost:4000/api/health

# After verification, restore docker-compose.yml to use ${ENV} again
git checkout docker-compose.yml  # Or manually revert changes
```

### Rollback by Re-deploying Previous Commit

**Alternative: Push previous commit to trigger CI/CD rebuild**
```bash
# Find previous working commit
git log --oneline

# Create rollback branch from previous commit
git checkout -b rollback-<commit-sha> <commit-sha>

# Force push to main (production)
git push origin rollback-<commit-sha>:main --force

# Wait for GitHub Actions to build and push images
# Then run deployment script
./scripts/droplet-update.sh prod
```

**Warning:** Force pushing to main should be a last resort. Prefer rolling forward with a fix commit.

## Troubleshooting Deployments

### Deployment Script Fails

**SSH connection refused:**
```bash
# Verify droplet is running
# Log in to Digital Ocean console and check droplet status

# Verify SSH key is authorized
ssh-copy-id root@<DROPLET_IP>

# Verify firewall allows SSH
ssh root@<DROPLET_IP> 'sudo ufw status'
```

**Docker image pull fails:**
```bash
# Verify GHCR authentication
ssh root@<DROPLET_IP>
docker login ghcr.io -u delphian

# Re-authenticate with fresh token
echo '<NEW_GITHUB_TOKEN>' | docker login ghcr.io -u delphian --password-stdin

# Check ENV variable in .env file
grep ^ENV /opt/tronrelic/.env

# Manually pull images (use correct environment tag from ENV)
docker pull ghcr.io/delphian/tronrelic/backend:production     # If ENV=production
docker pull ghcr.io/delphian/tronrelic/frontend:production    # If ENV=production
# or
docker pull ghcr.io/delphian/tronrelic/backend:production     # Universal tag
docker pull ghcr.io/delphian/tronrelic/frontend:production    # Universal tag
```

**Containers fail health checks:**
```bash
# SSH to server
ssh root@<DROPLET_IP>
cd /opt/tronrelic

# View container logs
docker compose logs backend
docker compose logs frontend

# Common issues:
# - Missing .env file
# - Invalid MongoDB/Redis credentials
# - Port conflicts (another service using 3000/4000)
# - Insufficient memory (check docker stats)
```

### CI/CD Pipeline Fails

**Integration tests fail:**
```bash
# View test results in GitHub Actions
# Navigate to: Actions tab → Failed workflow → integration-test job

# Download Playwright artifacts (screenshots, reports)
# Check for visual regressions or API errors

# Fix tests locally before pushing again
npm run test:integration
```

**Build fails:**
```bash
# View build logs in GitHub Actions
# Navigate to: Actions tab → Failed workflow → build-and-push job

# Common issues:
# - TypeScript compilation errors (fix in IDE)
# - Missing dependencies (check package.json)
# - Docker build context too large (check .dockerignore)
```

**Manual deployment fails:**
```bash
# Test SSH connection
ssh root@<DROPLET_IP>

# View container status on remote server
ssh root@<DROPLET_IP> 'cd /opt/tronrelic && docker compose ps'

# Manually deploy with verbose output
./scripts/droplet-update.sh prod
```

## Quick Reference

**Initial setup:**
```bash
# Production (with SSL)
./scripts/droplet-deploy.sh prod
./scripts/droplet-setup-ssl.sh prod tronrelic.com your-email@example.com

# Note: PR testing environments are automatically provisioned via GitHub Actions
```

**Manual updates:**
```bash
# Production
./scripts/droplet-update.sh prod

# Note: PR testing environments update automatically on push to PR branch
```

**Verify deployment:**
```bash
# Check health endpoints
curl https://tronrelic.com/api/health
curl http://dev.tronrelic.com/api/health

# View logs
ssh root@<DROPLET_IP> 'cd /opt/tronrelic && docker compose logs -f'
```

**Rollback:**
```bash
# Edit docker-compose.yml to use previous commit SHA tag
ssh root@<DROPLET_IP>
cd /opt/tronrelic
nano docker-compose.yml  # Change image: from :production to :production-<SHA>
docker compose down && docker compose up -d
# Restore docker-compose.yml after verification
```

## GitHub Repository Secrets

The GitHub Actions CI/CD pipeline requires specific secrets to be configured in the repository settings for running integration tests.

### Required Secrets for CI/CD Testing

Navigate to **Settings → Secrets and variables → Actions** in the GitHub repository and add the following secrets:

| Secret Name | Purpose | Example Value | Required |
|------------|---------|---------------|----------|
| `ADMIN_API_TOKEN` | Admin API token for testing | Generate with `openssl rand -hex 32` | ✅ Yes |
| `TRONGRID_API_KEY` | TronGrid API key #1 | From https://www.trongrid.io/ | ✅ Yes |
| `TRONGRID_API_KEY_2` | TronGrid API key #2 | From https://www.trongrid.io/ | ✅ Yes |
| `TRONGRID_API_KEY_3` | TronGrid API key #3 | From https://www.trongrid.io/ | ✅ Yes |

### How Secrets Are Used

**During GitHub Actions test runs (.github/workflows/test.yml):**

1. The workflow uses secrets to configure the test environment
2. Integration tests run against Docker containers with these credentials
3. Tests validate functionality without requiring deployment to remote servers

**Note:** Deployment credentials (SSH keys, droplet IPs) are NOT stored in GitHub secrets since deployments are manual. Use `./scripts/droplet-update.sh` from your local machine with SSH keys configured locally.

### Verifying Test Configuration

After configuring test secrets, push a commit to trigger the test workflow:

```bash
git commit --allow-empty -m "Test CI/CD pipeline"
git push origin main  # or dev
```

Watch the GitHub Actions workflow run and verify:
- ✅ Integration tests execute successfully
- ✅ Docker images build without errors
- ✅ Images are pushed to GitHub Container Registry

### Security Best Practices

- **Rotate secrets periodically** (especially ADMIN_API_TOKEN and TronGrid API keys)
- **Never commit .env files** to version control (already in .gitignore)
- **Use test-specific credentials** for GitHub Actions (not production credentials)
- **Limit GitHub secret access** to repository administrators only
- **Audit secret usage** via GitHub Actions workflow run logs (secrets are masked)

## Further Reading

- [operations-docker.md](../system/operations-docker.md) - Unified Docker deployment standards and ENV convention
- [operations-server-info.md](./operations-server-info.md) - Server locations, credentials, authentication
- [operations-remote-access.md](./operations-remote-access.md) - SSH usage, debugging, log inspection
- [operations.md](./operations.md) - Deployment overview and quick reference
- [system-runtime-config.md](../system/system-runtime-config.md) - Runtime configuration system
- [README.md - Docker Quick Start](../../README.md#option-1-docker-recommended-for-production) - Docker commands and local development
- [README.md - Architecture](../../README.md#architecture) - System architecture and directory structure
