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
| **CI/CD Auto-Deploy** | Continuous deployment | Fully automated | Dev only |

**Recommendation:**
- Use **initial setup scripts** when provisioning a new server
- Use **manual update scripts** for production deployments (requires explicit approval)
- Use **CI/CD auto-deploy** for development (fast iteration, automatic on push to dev branch)

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
./scripts/droplet-deploy.sh <DROPLET_IP>

# Example:
./scripts/droplet-deploy.sh 206.189.95.8
```

**What the script does:**
1. **Verifies SSH connection** to droplet
2. **Installs Docker and Docker Compose** from official Docker repository
3. **Installs and configures Nginx** reverse proxy
4. **Configures UFW firewall** (allows SSH, HTTP, HTTPS)
5. **Authenticates with GitHub Container Registry** using your personal access token
6. **Creates deployment directory** at `/opt/tronrelic`
7. **Generates secure credentials** (ADMIN_API_TOKEN, MONGO_PASSWORD, REDIS_PASSWORD)
8. **Creates production .env file** with your TronGrid API keys and generated secrets
9. **Creates docker-compose.yml** configured for production (image tag `:latest`)
10. **Pulls Docker images** from ghcr.io/delphian/tronrelic
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
  3. Set up SSL/HTTPS with: ./scripts/droplet-setup-ssl.sh <DROPLET_IP> tronrelic.com admin@example.com
```

**Save the generated credentials immediately!** Store them in a password manager before proceeding.

**Setup SSL/HTTPS (required for production):**
```bash
# From your local machine
./scripts/droplet-setup-ssl.sh <DROPLET_IP> tronrelic.com your-email@example.com

# Example:
./scripts/droplet-setup-ssl.sh 206.189.95.8 tronrelic.com admin@tronrelic.com
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
- Domain DNS A record pointing dev.tronrelic.com to droplet IP (165.232.161.21)
- GitHub Personal Access Token with `read:packages` scope
- Three TronGrid API keys

**Run development setup script:**
```bash
# From your local machine
./scripts/droplet-deploy-dev.sh

# Or skip confirmation prompt
./scripts/droplet-deploy-dev.sh --force
```

**Differences from production setup:**
- **Deployment directory:** `/opt/tronrelic-dev` (separate from production)
- **Docker image tags:** `:dev` instead of `:latest`
- **No SSL setup** (development uses HTTP for faster iteration)
- **Auto-deployment enabled** via GitHub Actions (pushes to `dev` branch trigger automatic updates)

**Expected output:**
```
DEPLOYMENT COMPLETE!

Application URLs (via Nginx on port 80):
  Frontend:     http://dev.tronrelic.com/
  Backend API:  http://dev.tronrelic.com/api
  System:       http://dev.tronrelic.com/system

Configuration:
  Environment:  DEVELOPMENT
  Image tags:   :dev
  Nginx:        Reverse proxy on port 80

Next Steps:
  1. Access the frontend at http://dev.tronrelic.com/
  2. Push to 'dev' branch to trigger automatic deployments
  3. Use ./scripts/droplet-update-dev.sh for manual updates
```

**Configure GitHub Actions auto-deployment:**

The development environment supports automatic deployment via GitHub Actions. Set up repository secrets:

1. Navigate to repository Settings → Secrets and variables → Actions
2. Add these secrets:
   - `DEV_DROPLET_HOST` = 165.232.161.21
   - `DEV_DROPLET_USER` = root
   - `DEV_DROPLET_SSH_KEY` = (paste full SSH private key)

**Test auto-deployment:**
```bash
# Make a change and push to dev branch
git checkout dev
echo "test change" >> README.md
git commit -am "Test auto-deployment"
git push origin dev

# GitHub Actions will:
# 1. Build backend:dev and frontend:dev images
# 2. Push images to ghcr.io
# 3. SSH to dev server and run: docker compose pull && docker compose up -d
```

## Manual Deployment Updates

Use these scripts to manually update running deployments with the latest Docker images.

### Update Production

**When to use:**
- Deploy new features after testing in development
- Apply hotfixes to production
- Manually trigger deployment after pushing to `main` branch

**Prerequisites:**
- Latest Docker images pushed to ghcr.io with `:latest` tag
- GitHub Actions workflow completed successfully (check Actions tab)

**Run update script:**
```bash
# From your local machine
./scripts/droplet-update.sh

# Or skip confirmation prompt
./scripts/droplet-update.sh --force
```

**What the script does:**
1. **Verifies SSH connection** to production server
2. **Shows current container status** (docker compose ps)
3. **Pulls latest images** from ghcr.io (`:latest` tags)
4. **Restarts containers** with new images (docker compose down && up -d)
5. **Waits for startup** (15 seconds)
6. **Checks container health** (docker compose ps)
7. **Verifies backend health** (curl http://localhost:4000/api/health)
8. **Verifies frontend health** (curl http://localhost:3000/)

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
- Manual deployment when CI/CD auto-deploy is disabled
- Force update after failed auto-deployment
- Test deployment scripts before using on production

**Run update script:**
```bash
# From your local machine
./scripts/droplet-update-dev.sh

# Or skip confirmation prompt
./scripts/droplet-update-dev.sh --force
```

**What the script does:**
1. **Verifies SSH connection** to development server (165.232.161.21)
2. **Shows current container status**
3. **Pulls latest :dev images** from ghcr.io
4. **Restarts containers** with new images
5. **Waits for startup** (15 seconds)
6. **Checks container health**
7. **Verifies backend and frontend health** via Nginx

**Expected output:**
```
Dev deployment complete!

Application URLs:
  Frontend: http://165.232.161.21/
  Backend:  http://165.232.161.21/api
  System:   http://165.232.161.21/system

View logs with:
  ssh root@165.232.161.21 'cd /opt/tronrelic-dev && docker compose logs -f'
```

## CI/CD Automated Deployment

TronRelic uses GitHub Actions for continuous integration and deployment.

### Production CI/CD (main branch)

**Trigger:** Push to `main` branch or pull request to `main`

**Workflow file:** `.github/workflows/docker-publish.yml`

**Pipeline stages:**

1. **Integration Tests:**
   - Checkout code
   - Build backend and frontend images with `:test` tags
   - Start MongoDB, Redis, backend, frontend via docker compose
   - Wait for backend health check
   - Run Playwright integration tests
   - Upload test artifacts (screenshots, reports)
   - Stop and clean up containers

2. **Build and Push (only on successful tests):**
   - Log in to GitHub Container Registry (ghcr.io)
   - Build and tag backend image (`:latest` and `:$COMMIT_SHA`)
   - Push backend image to ghcr.io
   - Build and tag frontend image (`:latest` and `:$COMMIT_SHA`)
   - Push frontend image to ghcr.io

3. **Manual Deployment:**
   - GitHub Actions does NOT automatically deploy to production
   - Run `./scripts/droplet-update.sh` manually after verifying images

**Why manual production deployment?**
- Extra safety for production changes
- Allows verification of images before deployment
- Enables scheduled deployment windows (maintenance windows)
- Prevents accidental production deployments

**Trigger production deployment:**
```bash
# After GitHub Actions completes successfully:
./scripts/droplet-update.sh
```

### Development CI/CD (dev branch)

**Trigger:** Push to `dev` branch

**Workflow file:** `.github/workflows/docker-publish-dev.yml`

**Pipeline stages:**

1. **Build and Push:**
   - Log in to GitHub Container Registry (ghcr.io)
   - Build and tag backend image (`:dev` and `:dev-$COMMIT_SHA`)
   - Push backend image to ghcr.io
   - Build and tag frontend image (`:dev` and `:dev-$COMMIT_SHA`)
   - Push frontend image to ghcr.io

2. **Automatic Deployment:**
   - SSH to dev.tronrelic.com (165.232.161.21)
   - Run `cd /opt/tronrelic-dev && docker compose pull`
   - Run `docker compose down && docker compose up -d`
   - Wait 15 seconds for startup
   - Show container status

**Why automatic dev deployment?**
- Faster iteration during development
- Immediate feedback on changes
- Reduces manual deployment overhead
- Dev environment is isolated from production

**Monitor auto-deployment:**
```bash
# View GitHub Actions workflow
# Navigate to: https://github.com/delphian/tronrelic/actions

# View deployment logs
ssh root@165.232.161.21 'cd /opt/tronrelic-dev && docker compose logs --tail=100 -f'
```

## Environment-Specific Configuration

### Production Environment

**Configuration file:** `/opt/tronrelic/.env`

**Key differences from development:**
```bash
# Database authentication REQUIRED
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=<secure-password>
REDIS_PASSWORD=<secure-password>

# HTTPS URLs
NEXT_PUBLIC_API_URL=https://tronrelic.com/api
NEXT_PUBLIC_SOCKET_URL=https://tronrelic.com
NEXT_PUBLIC_SITE_URL=https://tronrelic.com

# MongoDB connection with auth
MONGODB_URI=mongodb://admin:<password>@mongodb:27017/tronrelic?authSource=admin

# Redis connection with auth
REDIS_URL=redis://:<password>@redis:6379
```

**Docker Compose configuration:** `/opt/tronrelic/docker-compose.yml`
```yaml
services:
  backend:
    image: ghcr.io/delphian/tronrelic/backend:latest  # Production tag
    container_name: tronrelic-backend-prod
  frontend:
    image: ghcr.io/delphian/tronrelic/frontend:latest  # Production tag
    container_name: tronrelic-frontend-prod
  mongodb:
    container_name: tronrelic-mongo-prod
    command: ["mongod", "--auth"]  # Authentication enabled
  redis:
    container_name: tronrelic-redis-prod
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]  # Auth enabled
```

### Development Environment

**Configuration file:** `/opt/tronrelic-dev/.env`

**Key differences from production:**
```bash
# Database authentication enabled (same as production)
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=<secure-password>
REDIS_PASSWORD=<secure-password>

# HTTP URLs (no SSL)
NEXT_PUBLIC_API_URL=http://dev.tronrelic.com/api
NEXT_PUBLIC_SOCKET_URL=http://dev.tronrelic.com
NEXT_PUBLIC_SITE_URL=http://dev.tronrelic.com

# MongoDB connection with auth
MONGODB_URI=mongodb://admin:<password>@mongodb:27017/tronrelic?authSource=admin

# Redis connection with auth
REDIS_URL=redis://:<password>@redis:6379
```

**Docker Compose configuration:** `/opt/tronrelic-dev/docker-compose.yml`
```yaml
services:
  backend:
    image: ghcr.io/delphian/tronrelic/backend:dev  # Development tag
    container_name: tronrelic-backend-dev
  frontend:
    image: ghcr.io/delphian/tronrelic/frontend:dev  # Development tag
    container_name: tronrelic-frontend-dev
  mongodb:
    container_name: tronrelic-mongo-dev
    command: ["mongod", "--auth"]  # Authentication enabled
  redis:
    container_name: tronrelic-redis-dev
    command: ["redis-server", "--requirepass", "${REDIS_PASSWORD}"]  # Auth enabled
```

## Deployment Rollback

**If a deployment introduces bugs or breaks production**, rollback to the previous working version.

### Rollback by Image Tag

**Every deployment is tagged with commit SHA** for easy rollback:
```bash
# SSH to server
ssh root@<DROPLET_IP>
cd /opt/tronrelic  # or /opt/tronrelic-dev

# List available image tags
docker image ls | grep tronrelic

# Update docker-compose.yml to use specific commit SHA
# Change: ghcr.io/delphian/tronrelic/backend:latest
# To:     ghcr.io/delphian/tronrelic/backend:<COMMIT_SHA>

nano docker-compose.yml  # or vim

# Restart containers with old image
docker compose down
docker compose up -d

# Verify rollback worked
docker compose ps
curl http://localhost:4000/api/health
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
./scripts/droplet-update.sh  # or droplet-update-dev.sh
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

# Manually pull images
docker pull ghcr.io/delphian/tronrelic/backend:latest
docker pull ghcr.io/delphian/tronrelic/frontend:latest
```

**Containers fail health checks:**
```bash
# SSH to server
ssh root@<DROPLET_IP>
cd /opt/tronrelic  # or /opt/tronrelic-dev

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

**Auto-deployment fails (dev only):**
```bash
# View deployment logs in GitHub Actions
# Navigate to: Actions tab → Failed workflow → deploy to dev droplet step

# Verify SSH key is correct in GitHub secrets
# Verify dev droplet is accessible from GitHub Actions runners
# Manually run deployment script to test
./scripts/droplet-update-dev.sh
```

## Quick Reference

**Initial setup:**
```bash
# Production (with SSL)
./scripts/droplet-deploy.sh <DROPLET_IP>
./scripts/droplet-setup-ssl.sh <DROPLET_IP> tronrelic.com your-email@example.com

# Development
./scripts/droplet-deploy-dev.sh
```

**Manual updates:**
```bash
# Production
./scripts/droplet-update.sh

# Development
./scripts/droplet-update-dev.sh
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
# Edit docker-compose.yml to use previous commit SHA
ssh root@<DROPLET_IP>
cd /opt/tronrelic
nano docker-compose.yml  # Change image tag
docker compose down && docker compose up -d
```

## Further Reading

- [operations-server-info.md](./operations-server-info.md) - Server locations, credentials, authentication
- [operations-remote-access.md](./operations-remote-access.md) - SSH usage, debugging, log inspection
- [operations.md](./operations.md) - Deployment overview and quick reference
- [docker-deployment.md](../docker-deployment.md) - Docker architecture and local development
