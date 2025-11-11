# TronRelic Docker Standards

## Overview

TronRelic uses **two distinct Docker image tagging strategies** depending on deployment type:

1. **Production deployments** - Use universal `:production` tagged images with runtime `ENV` variable control
2. **PR testing environments** - Use branch-specific `:dev-{sha}` tagged images for isolated testing

This document covers both strategies and when to use each.

## Core Convention

### Universal Production Images (Manual Deployments)

**Key principle:** Production and manual deployments use `:production` tagged images regardless of target environment.

Environment differentiation happens at **runtime through environment variables**, not at build time through image tags.

### Single Environment Variable

Only two values are permitted:
- `ENV=development` - Development/staging environments
- `ENV=production` - Production environments

This variable controls:
- Node.js runtime (`NODE_ENV=development` or `NODE_ENV=production`)
- Feature flags and logging levels
- All environment-specific behavior

**What it does NOT control:**
- Docker image tags (always `:production`)
- Container names (always the same)
- Build output (images are identical)

### Implementation

**docker-compose.yml (unified for all environments):**
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
```

**Environment differentiation via .env file:**
```bash
# Development server: /opt/tronrelic/.env
ENV=development
SITE_URL=https://dev.tronrelic.com

# Production server: /opt/tronrelic/.env
ENV=production
SITE_URL=https://tronrelic.com
```

## Image Tagging Convention

### Production Deployments (Manual)

**Builds from `main` branch:**
- MUST tag as `:production` only
- NO environment-specific tags (`:development`, `:dev`, `:prod`)
- NO dual-tagging with `:latest`

**Used by:**
- Production server (tronrelic.com)
- Manual deployments via `./scripts/droplet-update.sh`

**Rationale:**
- Images are byte-for-byte identical
- Eliminates confusion about which tag to use
- Simplifies docker-compose.yml (no variable substitution needed)
- Prevents accidental deployments with wrong tags

### PR Testing Environments (Automated)

**Builds from PR branches:**
- MUST tag as `:dev-{sha}` (e.g., `:dev-a1b2c3d`)
- Built from PR branch code (not `main`)
- Unique tag per commit to prevent caching issues

**Used by:**
- Ephemeral PR testing droplets (pr-{number}.dev-pr.tronrelic.com)
- Fully automated via `.github/workflows/pr-environment.yml`

**Why different from production:**
- Allows testing unreleased code in isolated environments
- Prevents conflicts between concurrent PR environments
- Each PR gets its own immutable image snapshot
- Automatic cleanup when PR closes/merges

**Example workflow:**
```yaml
# PR environment builds use commit SHA
IMAGE_TAG="dev-${SHORT_SHA}"
docker build -t ghcr.io/delphian/tronrelic/backend:dev-a1b2c3d .
docker push ghcr.io/delphian/tronrelic/backend:dev-a1b2c3d
```

### GitHub Actions Implementation

**Production workflow (`.github/workflows/prod-publish.yml`):**
```yaml
# Builds on push to main branch
- name: Build and push production images
  run: |
    docker build --target backend -t ghcr.io/delphian/tronrelic/backend:production .
    docker push ghcr.io/delphian/tronrelic/backend:production

    docker build --target frontend-prod -t ghcr.io/delphian/tronrelic/frontend:production .
    docker push ghcr.io/delphian/tronrelic/frontend:production
```

**PR testing workflow (`.github/workflows/pr-environment.yml`):**
```yaml
# Builds on PR to main branch
- name: Prepare image tag
  run: |
    SHORT_SHA=$(echo "${{ github.event.pull_request.head.sha }}" | cut -c1-7)
    IMAGE_TAG="dev-${SHORT_SHA}"

- name: Build and push PR images
  run: |
    docker build --target backend -t ghcr.io/delphian/tronrelic/backend:$IMAGE_TAG .
    docker push ghcr.io/delphian/tronrelic/backend:$IMAGE_TAG

    docker build --target frontend-prod -t ghcr.io/delphian/tronrelic/frontend:$IMAGE_TAG .
    docker push ghcr.io/delphian/tronrelic/frontend:$IMAGE_TAG
```

## Naming Conventions

### Container Names

All environments use **identical container names** (no `-prod` or `-dev` suffixes):

| Service | Container Name |
|---------|----------------|
| MongoDB | `tronrelic-mongo` |
| Redis | `tronrelic-redis` |
| Backend | `tronrelic-backend` |
| Frontend | `tronrelic-frontend` |

**Benefits:** Simplified scripts, consistent monitoring commands, reduced configuration errors.

### Volume Names

All environments use **identical volume names**:
- `tronrelic-mongo-data`
- `tronrelic-redis-data`

**Benefits:** Consistent backup/restore procedures, simplified volume management.

## Deployment Convention

All servers use the **same deployment directory and process**:

```bash
# Deployment directory (all environments)
/opt/tronrelic/

# Deployment command (same for all environments)
cd /opt/tronrelic
docker compose up -d
```

Environment differentiation is **entirely controlled by .env file content**, not directory paths or container names.

## Benefits

### Production Deployment Benefits

**Maximum simplicity:** All manual deployments use `:production` tag. No decision-making required for image selection.

**Universal images:** Single Docker image works on any domain or environment without rebuilding.

**Runtime configuration:** Frontend fetches configuration from backend API at SSR time, enabling true build-once-deploy-anywhere workflows.

**Single source of truth:** ENV variable in .env file determines runtime behavior—impossible to have mismatched image tags and runtime config.

### PR Testing Environment Benefits

**Isolated testing:** Each PR gets its own unique image (`:dev-{sha}`), preventing conflicts between concurrent PRs.

**Immutable snapshots:** Commit-specific tags ensure PR environments always run exact code from that commit.

**Automatic cleanup:** Images tagged `:dev-{sha}` are automatically pruned when PRs close, reducing registry storage costs.

**Branch testing:** Test unreleased code without affecting production images or other PR environments.

### Shared Benefits (Both Strategies)

**Industry alignment:** Uses Node.js standard `NODE_ENV` conventions (development/production) instead of custom naming schemes.

**Clear intent:** `development` and `production` are explicit and unambiguous, unlike abbreviations or aliases.

**Consistent infrastructure:** All environments use same container names, deployment paths, and docker-compose.yml structure.

## Security Checklist

**Required secrets (generate with `openssl rand -hex 32`):**
- `ADMIN_API_TOKEN` - Access to /system monitoring endpoint
- `MONGO_ROOT_PASSWORD` - MongoDB authentication
- `REDIS_PASSWORD` - Redis authentication

**Best practices:**
- [ ] Never commit .env files to version control
- [ ] Use strong, unique passwords for each environment
- [ ] Rotate credentials periodically
- [ ] Enable authentication on all remote deployments
- [ ] Use TLS/SSL for production deployments

## Quick Reference

### Environment Variables

| Variable | Development | Production |
|----------|------------|------------|
| `ENV` | `development` | `production` |
| `SITE_URL` | `https://dev.tronrelic.com` | `https://tronrelic.com` |
| `NODE_ENV` | `development` (auto-set) | `production` (auto-set) |

### Image Tags

All environments use the same images:

| Service | Image |
|---------|-------|
| Backend | `ghcr.io/delphian/tronrelic/backend:production` |
| Frontend | `ghcr.io/delphian/tronrelic/frontend:production` |

### Container Names (identical for all environments)

- `tronrelic-mongo`
- `tronrelic-redis`
- `tronrelic-backend`
- `tronrelic-frontend`

## Migration from Old System

**Deprecated tags (no longer used):**
- `:development` (replaced by `:production` for all environments)
- `:dev` (replaced by `:production` for all environments)
- `:latest` (not used)

**Required changes:**
1. Update CI/CD workflows to always tag as `:production`
2. Update docker-compose.yml to use hardcoded `:production` tags (no `${ENV}` variable substitution)
3. ENV variable now controls runtime behavior only, not image selection
4. Deployment scripts pull `:production` images for all environments

**Migration procedure:**
1. Update GitHub Actions workflow to build `:production` tags only
2. Update docker-compose.yml to reference `:production` images
3. Pull new `:production` images on all servers: `docker compose pull`
4. Restart containers: `docker compose up -d`
5. Verify ENV variable in .env controls runtime behavior correctly
6. Clean up old Docker images: `docker image prune -af`

## Troubleshooting

**Images not updating after deployment:**
- Run `docker compose pull` to fetch latest `:production` images
- Check that CI/CD successfully pushed new images to GHCR
- Verify image digest: `docker image inspect ghcr.io/delphian/tronrelic/backend:production`

**Wrong runtime behavior:**
- Check `ENV` value in .env file (must be exactly `development` or `production`)
- Verify container picked up ENV: `docker exec tronrelic-backend env | grep NODE_ENV`
- Restart containers if ENV was changed: `docker compose restart`

**Container name conflicts:**
- Stop old containers: `docker stop tronrelic-backend-prod tronrelic-backend-dev`
- Remove old containers: `docker rm tronrelic-backend-prod tronrelic-backend-dev`
- Remove old networks if needed: `docker network rm tronrelic-network-prod`

**Authentication failures:**
- Verify MONGO_ROOT_PASSWORD and REDIS_PASSWORD are set in .env
- Check connection strings include credentials (see environment.md)
- Ensure MongoDB/Redis containers started with --auth flag

**Runtime configuration not loading:**
- Verify backend health: `curl http://localhost:4000/api/config/public`
- Check frontend SSR logs for config fetch errors
- Ensure SITE_URL is set correctly in .env

## Further Reading

**Related documentation:**
- [operations-workflows.md](../operations/operations-workflows.md) - Deployment procedures and CI/CD pipelines
- [system-runtime-config.md](./system-runtime-config.md) - Runtime configuration system architecture
- [environment.md](../environment.md) - Complete environment variable reference
- [README.md - Docker Quick Start](../../README.md#docker-quick-start) - Local development with Docker
