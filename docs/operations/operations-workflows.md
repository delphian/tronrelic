# Deployment Workflows

This document describes the complete procedures for deploying TronRelic to production and development environments, from initial server setup to routine updates.

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
- Use **initial setup scripts** when provisioning a new server
- Use **manual update scripts** for all deployments (both production and development)
- **CI/CD builds Docker images** automatically but does not deploy them to servers

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

# Example (development):
./scripts/droplet-deploy.sh dev
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

# Example (development - if using custom domain):
./scripts/droplet-setup-ssl.sh dev dev.tronrelic.com admin@tronrelic.com
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

### Development Setup (dev.tronrelic.com)

**Prerequisites:**
- Fresh Ubuntu 22.04+ Digital Ocean droplet
- Root SSH access configured
- Domain DNS A record pointing dev.tronrelic.com to droplet IP (<DEV_DROPLET_IP>)
- GitHub Personal Access Token with `read:packages` scope
- Three TronGrid API keys

**Run development setup script:**
```bash
# From your local machine
./scripts/droplet-deploy.sh dev

# Or skip confirmation prompt
./scripts/droplet-deploy.sh dev --force
```

**Differences from production setup:**
- **Environment variable:** `ENV=development` (production uses `ENV=production`)
- **Docker image tags:** `:production` (same as prod, ENV controls behavior)
- **No SSL setup** (development uses HTTP for faster iteration)

**Note:** Development and production use identical deployment directory (`/opt/tronrelic`), container names, and docker-compose.yml per the unified Docker standards. Only the `ENV` variable in the .env file differs between environments (see [operations-docker.md](../system/operations-docker.md)).

**Expected output:**
```
DEPLOYMENT COMPLETE!

Application URLs (via Nginx on port 80):
  Frontend:     http://dev.tronrelic.com/
  Backend API:  http://dev.tronrelic.com/api
  System:       http://dev.tronrelic.com/system

Configuration:
  Environment:  DEVELOPMENT (ENV=development)
  Image tags:   :production (same as prod)
  Nginx:        Reverse proxy on port 80

Next Steps:
  1. Access the frontend at http://dev.tronrelic.com/
  2. Push to 'dev' branch to trigger CI/CD image builds
  3. Use ./scripts/droplet-update.sh dev to deploy the new images
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

### Update Development

**When to use:**
- Deploy new features to development environment
- Test deployment scripts before using on production
- Apply updates after pushing to `dev` branch

**Run update script:**
```bash
# From your local machine
./scripts/droplet-update.sh dev

# Or skip confirmation prompt
./scripts/droplet-update.sh dev --force
```

**What the script does:**
1. **Verifies SSH connection** to development server (<DEV_DROPLET_IP>)
2. **Shows current container status**
3. **Pulls latest :production images** from ghcr.io (same images as prod)
4. **Restarts containers** with new images using full restart strategy (docker compose down && docker compose up -d)
5. **Waits for startup** (15 seconds)
6. **Checks container health**
7. **Verifies backend and frontend health** via Nginx

**Development restart strategy:**
Development uses `docker compose down && docker compose up -d` which performs a full restart. This ensures a completely clean state, which is more suitable for development environments where state consistency matters more than uptime.

**Expected output:**
```
Dev deployment complete!

Application URLs:
  Frontend: http://<DEV_DROPLET_IP>/
  Backend:  http://<DEV_DROPLET_IP>/api
  System:   http://<DEV_DROPLET_IP>/system

View logs with:
  ssh root@<DEV_DROPLET_IP> 'cd /opt/tronrelic && docker compose logs -f'
```

## CI/CD Image Building

TronRelic uses GitHub Actions for continuous integration and automated Docker image builds. All images are tagged as `:production` regardless of target environment. Deployment to servers is always manual.

**Workflow file:** `.github/workflows/docker-publish.yml`

**Triggers:**
- Push to `main` branch (for tronrelic.com deployment)
- Push to `dev` branch (for dev.tronrelic.com deployment)
- Pull requests to either branch

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
   - Run appropriate deployment script manually after verifying images:
     - Production: `./scripts/droplet-update.sh prod`
     - Development: `./scripts/droplet-update.sh dev`

**Why manual deployment?**
- Extra safety for production changes
- Allows verification of images before deployment
- Enables scheduled deployment windows (maintenance windows)
- Prevents accidental deployments
- Consistent workflow across all environments

**Deploy after successful build:**
```bash
# Production (after push to main):
./scripts/droplet-update.sh prod

# Development (after push to dev):
./scripts/droplet-update.sh dev

# View deployment logs
ssh root@<DROPLET_IP> 'cd /opt/tronrelic && docker compose logs --tail=100 -f'
```

**Why single :production tag for all environments?**
- Images are identical regardless of deployment target
- ENV variable in server .env file controls runtime behavior
- Eliminates confusion about which tag to use
- Simplifies docker-compose.yml (no ${ENV} variable needed)

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

### Development Environment

**Configuration file:** `/opt/tronrelic/.env`

**Development-specific values:**
```bash
# Environment identifier (controls image tags and runtime)
ENV=development

# Site configuration
SITE_URL=https://dev.tronrelic.com
SITE_WS=https://dev.tronrelic.com
SITE_BACKEND=http://backend:4000

# Database authentication (same as production)
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=<secure-password>
REDIS_PASSWORD=<secure-password>

# Database connections (same as production)
MONGODB_URI=mongodb://admin:<password>@mongodb:27017/tronrelic?authSource=admin
REDIS_URL=redis://:<password>@redis:6379

# Feature flags (same as production)
ENABLE_SCHEDULER=true
ENABLE_WEBSOCKETS=true

# API keys (can use same or different keys)
ADMIN_API_TOKEN=<dev-token>
TRONGRID_API_KEY=<key1>
TRONGRID_API_KEY_2=<key2>
TRONGRID_API_KEY_3=<key3>
```

**Docker behavior with `ENV=development`:**
- Pulls `ghcr.io/delphian/tronrelic/backend:production`
- Pulls `ghcr.io/delphian/tronrelic/frontend:production`
- Sets `NODE_ENV=development` in containers
- Uses development-optimized frontend build

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

# Force push to main (production) or dev (development)
git push origin rollback-<commit-sha>:main --force

# Wait for GitHub Actions to build and push images
# Then run deployment script
./scripts/droplet-update.sh prod  # or: ./scripts/droplet-update.sh dev
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
./scripts/droplet-update.sh dev  # or prod
```

## Quick Reference

**Initial setup:**
```bash
# Production (with SSL)
./scripts/droplet-deploy.sh prod
./scripts/droplet-setup-ssl.sh prod tronrelic.com your-email@example.com

# Development
./scripts/droplet-deploy.sh dev
```

**Manual updates:**
```bash
# Production
./scripts/droplet-update.sh prod

# Development
./scripts/droplet-update.sh dev
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
