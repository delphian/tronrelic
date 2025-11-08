# TronRelic Deployment Overview

This directory contains comprehensive documentation for deploying TronRelic to Digital Ocean droplets.

## Who This Document Is For

This documentation is for developers and operators who need to deploy, update, or debug TronRelic on remote servers. Whether you're setting up a fresh production environment, pushing updates to development, or troubleshooting issues on a live server, these guides provide the workflows and commands you need.

## Why This Matters

**Risk of incomplete deployment knowledge:**
- Manual deployment errors can cause production downtime
- Incorrect server configurations expose security vulnerabilities
- Lost credentials prevent system administration access
- Lack of debugging knowledge delays incident response

**Benefits of standardized deployment workflows:**
- Reproducible deployments reduce human error
- Documented server information prevents access lockout
- Scripted workflows enable CI/CD automation
- Remote debugging procedures minimize downtime during incidents

## TronRelic Deployment Architecture

TronRelic uses a **unified Docker deployment system** where environment differentiation is controlled by a single `ENV` variable in the `.env` file. Both development and production servers use identical container names, deployment directories, and docker-compose.yml configuration.

### Environment Types

TronRelic maintains **four distinct environment types** with different automation levels and lifecycles:

```
1. Production (tronrelic.com) - MANUAL DEPLOYMENT
├── Domain: tronrelic.com
├── Server: Permanent Digital Ocean Droplet (<PROD_DROPLET_IP>)
├── Deployment: /opt/tronrelic
├── Docker Images: ghcr.io/delphian/tronrelic/*:production
├── ENV Variable: ENV=production
├── Trigger: Push to 'main' builds images → Manual deployment with ./scripts/droplet-update.sh prod
└── Lifespan: Permanent (until manually destroyed)

2. Permanent Dev Server (dev.tronrelic.com) - MANUAL DEPLOYMENT
├── Domain: dev.tronrelic.com (optional, if configured)
├── Server: Permanent Digital Ocean Droplet (<DEV_DROPLET_IP>)
├── Deployment: /opt/tronrelic
├── Docker Images: ghcr.io/delphian/tronrelic/*:production (same as prod)
├── ENV Variable: ENV=development
├── Trigger: Push to 'dev' builds images → Manual deployment with ./scripts/droplet-update.sh dev
└── Lifespan: Permanent (until manually destroyed)

3. Main-PR Environments - FULLY AUTOMATED
├── Domain: dev.tronrelic.com (opportunistic - uses reserved IP if available)
├── Server: Temporary droplet per PR to main (tronrelic-main-pr-{number})
├── Deployment: /opt/tronrelic
├── Docker Images: ghcr.io/delphian/tronrelic/*:dev-{sha} (built from PR branch)
├── ENV Variable: ENV=development
├── Trigger: AUTOMATIC - Opening PR to 'main' branch
├── Provisioning: Full stack with Nginx + SSL if reserved IP available, otherwise direct IP access
├── Lifespan: Persists until PR is closed/merged
└── Workflow: .github/workflows/main-pr-environment.yml

4. Dev-PR Environments - FULLY AUTOMATED
├── Domain: Direct IP access (no domain)
├── Server: Temporary droplet per PR to dev (tronrelic-dev-pr-{number})
├── Deployment: /opt/tronrelic
├── Docker Images: ghcr.io/delphian/tronrelic/*:pr-{branch}-{sha}
├── ENV Variable: ENV=development
├── Access: http://{ip}:3000 (frontend), http://{ip}:4000 (backend)
├── Trigger: AUTOMATIC - Opening PR to 'dev' branch
├── Updates: Automatically redeploys on every push to PR branch
├── Lifespan: Persists until PR is closed/merged
└── Workflow: .github/workflows/dev-pr-environment.yml
```

**Key architectural decisions:**
- **Unified Docker deployment**: Single `ENV` variable controls image tags, Node.js runtime, and all environment behavior (see [operations-docker.md](../system/operations-docker.md))
- **Identical container names**: All environments use same names (`tronrelic-backend`, `tronrelic-frontend`) without environment suffixes
- **Runtime configuration**: Frontend fetches config from backend API at SSR time, enabling universal images that work on any domain
- **Nginx reverse proxy**: Routes traffic to backend (port 4000) and frontend (port 3000)
- **HTTPS with Let's Encrypt**: Production and ephemeral dev testing use SSL certificates for secure communication
- **GitHub Container Registry**: Stores Docker images built by GitHub Actions
- **MongoDB and Redis**: Run as Docker containers with persistent volumes

### Automation Matrix

| Environment | Provisioning | Image Building | Deployment | Teardown | Cost/Month |
|-------------|--------------|----------------|------------|----------|------------|
| **Production** | Manual script | Automatic (push to main) | Manual script | Manual | ~$24 (always on) |
| **Permanent Dev** | Manual script | Automatic (push to dev) | Manual script | Manual | ~$24 (always on) |
| **Main-PR** | **Automatic** | **Automatic** | **Automatic** | **Automatic** (PR close) | ~$24/PR (if left open for month) |
| **Dev-PR** | **Automatic** | **Automatic** | **Automatic** | **Automatic** (PR close) | ~$24/PR (if left open for month) |

**When opening PR to main:**
1. GitHub Actions builds `:dev-{sha}` images
2. GitHub Actions provisions droplet (`tronrelic-main-pr-{number}`)
3. If reserved IP available: assigns IP, configures Nginx + SSL
4. If reserved IP in use: uses dynamic IP, direct port access
5. Subsequent pushes update same droplet
6. Droplet destroys when PR closes/merges

**When opening PR to dev:**
1. GitHub Actions builds `:pr-{branch}-{sha}` images
2. GitHub Actions provisions droplet (`tronrelic-dev-pr-{number}`)
3. Uses dynamic IP with direct port access
4. Subsequent pushes update same droplet
5. Droplet destroys when PR closes/merges

## Detailed Documentation

This directory contains comprehensive documentation covering different aspects of deployment:

**See [operations-docker.md](../system/operations-docker.md) for complete details on:**
- Unified Docker deployment system architecture
- ENV variable convention (development/production)
- Universal :production image tagging (all environments use same images)
- Container naming conventions (unified names, no suffixes)
- Runtime configuration approach
- Migration from legacy multi-tag system

**See [operations-server-info.md](./operations-server-info.md) for complete details on:**
- Production and development server locations
- IP addresses and domain configurations
- SSH authentication and access procedures
- Required credentials and secrets management
- GitHub Container Registry authentication

**See [operations-workflows.md](./operations-workflows.md) for complete details on:**
- Initial server setup from bare Ubuntu to running TronRelic
- Manual deployment updates using deployment scripts
- CI/CD automation with GitHub Actions
- SSL certificate setup with Let's Encrypt
- Environment-specific configuration (production vs development)

**See [operations-remote-access.md](./operations-remote-access.md) for complete details on:**
- SSH connection procedures and authentication
- Docker container management commands
- Log inspection and debugging techniques
- Database access (MongoDB and Redis)
- Service health checks and monitoring

## Quick Reference

### Server Information

| Environment | Domain | IP Address | Deploy Directory | Image Tag | ENV Variable | Lifespan |
|-------------|--------|------------|------------------|-----------|--------------|----------|
| **Production** | tronrelic.com | <PROD_DROPLET_IP> | /opt/tronrelic | :production | ENV=production | Permanent |
| **Permanent Dev** | dev.tronrelic.com (optional) | <DEV_DROPLET_IP> | /opt/tronrelic | :production | ENV=development | Permanent |
| **Main-PR** | dev.tronrelic.com (if reserved IP available) | Reserved IP or dynamic | /opt/tronrelic | :dev-{sha} | ENV=development | Until PR closed |
| **Dev-PR** | Direct IP only | See PR comment | /opt/tronrelic | :pr-{branch}-{sha} | ENV=development | Until PR closed |

**Note:** The same domain `dev.tronrelic.com` can point to either:
- Permanent dev server (static droplet IP, manual deployment)
- Ephemeral testing droplet (reserved IP reassigned on each push, automated)

### Common Commands

**Connect to servers:**
```bash
# Production
ssh root@<PROD_DROPLET_IP>

# Development
ssh root@<DEV_DROPLET_IP>
```

**Deploy updates:**
```bash
# Production (manual)
./scripts/droplet-update.sh prod

# Development (manual)
./scripts/droplet-update.sh dev
```

**View logs:**
```bash
# On remote server (same path for all environments)
cd /opt/tronrelic
docker compose logs -f
docker compose logs -f backend
docker compose logs -f frontend
```

**Check service status:**
```bash
# On remote server
docker compose ps
docker stats --no-stream

# From local machine
./scripts/utils/droplet-stats.sh prod  # Production
./scripts/utils/droplet-stats.sh dev   # Development
```

**Access databases:**
```bash
# MongoDB (remote droplets require authentication)
# See MongoDB Access section in operations-remote-access.md for full details
ssh root@<DROPLET_IP> 'cd /opt/tronrelic && \
  docker exec -i -e MONGO_PASSWORD="<password>" tronrelic-mongo sh -c \
  "mongosh --username admin --password \"\$MONGO_PASSWORD\" --authenticationDatabase admin <db-name>"'

# Redis (remote droplets may require authentication)
docker exec -it tronrelic-redis redis-cli
```

### Deployment Checklist

**Initial setup (new server):**
- [ ] Provision Digital Ocean droplet with Ubuntu 22.04+
- [ ] Configure SSH key authentication
- [ ] Point DNS A record to droplet IP
- [ ] Generate GitHub Personal Access Token (read:packages scope)
- [ ] Obtain three TronGrid API keys
- [ ] Run initial deployment script (`./scripts/droplet-deploy.sh <env>`)
- [ ] Save generated credentials securely
- [ ] (Production only) Run SSL setup script (`./scripts/droplet-setup-ssl.sh prod <domain> <email>`)
- [ ] Verify deployment health checks

**Update deployment:**
- [ ] Push changes to appropriate branch (main or dev)
- [ ] Wait for GitHub Actions to build and push images
- [ ] Run manual deployment script: `./scripts/droplet-update.sh <env>`
- [ ] Verify containers restarted successfully
- [ ] Check application health via /api/health endpoint

**Troubleshooting:**
- [ ] Check container status: `docker compose ps`
- [ ] View logs: `docker compose logs -f backend frontend`
- [ ] Verify network connectivity: `curl http://localhost:4000/api/health`
- [ ] Check disk space: `df -h`
- [ ] Monitor resources: `./scripts/utils/droplet-stats.sh <env>`

## CI/CD Pipeline

TronRelic uses GitHub Actions with **three distinct workflow types**:

### 1. Production Image Building (Manual Deployment)

**Workflow file:** `.github/workflows/prod-publish.yml`

**Trigger:** Push to `main` branch

**Pipeline behavior:**
1. Runs all tests (unit and integration)
2. Builds backend and frontend images (only if tests pass)
3. Tags all images as `:production` (single universal tag)
4. Pushes images to GitHub Container Registry
5. **Manual deployment required** - Images built but NOT deployed automatically

**Deploy manually after build:**
```bash
./scripts/droplet-update.sh prod  # Production
./scripts/droplet-update.sh dev   # Permanent dev server (if exists)
```

**Image tag convention:**
- All images use `:production` tag regardless of target environment
- Images are identical; ENV variable in server .env controls runtime behavior
- Eliminates :development vs :production tag confusion
- See [operations-docker.md](../system/operations-docker.md) for complete Docker standards

### 2. Main-PR Environments (Fully Automated)

**Workflow files:**
- `.github/workflows/main-pr-environment.yml` - Provisions/updates Main-PR droplet
- `.github/workflows/main-pr-teardown.yml` - Cleanup on PR close

**Trigger:** Opening PR to `main` branch

**Pipeline behavior:**
1. Builds `:dev-{sha}` images from PR branch code
2. Creates droplet `tronrelic-main-pr-{number}` (if doesn't exist)
3. Opportunistically assigns reserved IP if available
4. If reserved IP available: Installs Nginx + SSL, uses dev.tronrelic.com domain
5. If reserved IP in use: Uses dynamic IP with direct port access
6. Deploys containers automatically
7. Updates on every push to PR branch
8. Auto-destroys when PR closes/merges

**Access:** Check PR comment for domain (with SSL) or direct IP URLs

**No manual deployment needed** - Fully automated, multiple PRs supported

### 3. Dev-PR Environments (Fully Automated)

**Workflow files:**
- `.github/workflows/dev-pr-environment.yml` - Provisions/updates Dev-PR droplet
- `.github/workflows/dev-pr-teardown.yml` - Cleanup on PR close

**Trigger:** Opening PR to `dev` branch

**Pipeline behavior:**
1. Builds `:pr-{branch}-{sha}` images from PR branch code
2. Creates droplet `tronrelic-dev-pr-{number}` (if doesn't exist)
3. Uses dynamic IP with direct port access
4. Deploys containers automatically
5. Updates on every push to PR branch
6. Auto-destroys when PR closes/merges

**Access:** Direct IP (see PR comment for URLs)

**No manual deployment needed** - Updates automatically on every PR push

## Security Considerations

**Required secrets (stored in .env on server):**
- `ADMIN_API_TOKEN` - Access to /system monitoring endpoint (generate with `openssl rand -hex 32`)
- `TRONGRID_API_KEY` (x3) - TronGrid API access keys
- `MONGO_ROOT_PASSWORD` - MongoDB authentication (production only)
- `REDIS_PASSWORD` - Redis authentication (production only)

**GitHub repository secrets (for CI/CD testing):**
- `ADMIN_API_TOKEN` - Testing only (not deployed to servers)
- `TRONGRID_API_KEY`, `TRONGRID_API_KEY_2`, `TRONGRID_API_KEY_3` - Testing only

**Note:** Deployment credentials (SSH keys, droplet IPs) are NOT stored in GitHub secrets since all deployments are manual.

**Best practices:**
- Never commit .env files or credentials to version control
- Rotate API tokens and passwords regularly
- Use SSH key authentication instead of passwords
- Enable firewall (UFW) to restrict access to necessary ports
- Use HTTPS/TLS for production deployments
- Regularly update base Docker images and system packages

## Further Reading

**Detailed documentation:**
- [operations-docker.md](../system/operations-docker.md) - Unified Docker deployment system, ENV convention, image tagging standards
- [operations-server-info.md](./operations-server-info.md) - Server locations, credentials, authentication
- [operations-workflows.md](./operations-workflows.md) - Setup and update procedures
- [operations-remote-access.md](./operations-remote-access.md) - SSH, debugging, remote management

**Related topics:**
- [system-runtime-config.md](../system/system-runtime-config.md) - Runtime configuration system enabling universal Docker images
- [README.md - Docker Quick Start](../../README.md#option-1-docker-recommended-for-production) - Docker architecture and local development
- [environment.md](../environment.md) - Environment variable configuration
- [system-api.md](../system/system-api.md) - API endpoints and health checks
