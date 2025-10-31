# TronRelic Docker Standards

## Overview

TronRelic uses a **unified Docker deployment system** where a single `ENV` variable controls image tags, Node.js runtime configuration, and all environment-specific behavior across development and production servers.

## Core Convention

### Single Environment Variable

Only two values are permitted:
- `ENV=development` - Development/staging environments
- `ENV=production` - Production environments

This variable controls:
- Docker image tags (`:development` or `:production`)
- Node.js runtime (`NODE_ENV=development` or `NODE_ENV=production`)
- All environment-specific behavior

### Implementation

**docker-compose.yml (unified for all environments):**
```yaml
services:
  backend:
    image: ghcr.io/delphian/tronrelic/backend:${ENV}
    container_name: tronrelic-backend
    environment:
      - NODE_ENV=${ENV}

  frontend:
    image: ghcr.io/delphian/tronrelic/frontend:${ENV}
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

### CI/CD Requirements

**Development builds (dev branch):**
- MUST tag as `:development` only
- NO additional tags (`:dev`, `:latest`, etc.)

**Production builds (main branch):**
- MUST tag as `:production` only
- NO dual-tagging with `:latest`

**Rationale:** Single tags eliminate ambiguity and prevent accidental deployments with wrong tags.

### GitHub Actions Implementation

```yaml
# Development
- name: Build development images
  run: |
    docker build --target backend -t ghcr.io/delphian/tronrelic/backend:development .
    docker push ghcr.io/delphian/tronrelic/backend:development

# Production
- name: Build production images
  run: |
    docker build --target backend -t ghcr.io/delphian/tronrelic/backend:production .
    docker push ghcr.io/delphian/tronrelic/backend:production
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

**Reduced complexity:** 3 variables (ENV, IMAGE_TAG, NODE_ENV) consolidated to 1 variable that controls all environment behavior.

**Industry alignment:** Uses Node.js standard `NODE_ENV` conventions (development/production) instead of custom naming schemes.

**Single source of truth:** One variable in .env file determines image tags, runtime configuration, and feature flags—impossible to have mismatched settings.

**Clear intent:** `development` and `production` are explicit and unambiguous, unlike abbreviations or aliases.

**Runtime configuration:** Frontend fetches configuration from backend API at SSR time, enabling universal Docker images that work on any domain without rebuilding.

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

| Environment | Backend | Frontend |
|------------|---------|----------|
| Development | `ghcr.io/delphian/tronrelic/backend:development` | `ghcr.io/delphian/tronrelic/frontend:development` |
| Production | `ghcr.io/delphian/tronrelic/backend:production` | `ghcr.io/delphian/tronrelic/frontend:production` |

### Container Names (identical for all environments)

- `tronrelic-mongo`
- `tronrelic-redis`
- `tronrelic-backend`
- `tronrelic-frontend`

## Migration from Old System

**Deprecated tags (no longer used):**
- `:dev` (replaced by `:development`)
- `:latest` (replaced by `:production`)

**Required changes:**
1. Update CI/CD workflows to use `:development`/`:production` tags only
2. Update deployment scripts to use `ENV` instead of `IMAGE_TAG` + `NODE_ENV`
3. Replace environment-specific docker-compose files with unified docker-compose.yml
4. Remove `-prod`/-dev` suffixes from container names
5. Frontend removes NEXT_PUBLIC_* build-time variables, uses runtime config from backend API

**Migration procedure:**
1. Deploy CI/CD updates to build new tags
2. Update docker-compose.yml to use `${ENV}` for image tags
3. Update .env files on servers with `ENV` variable
4. Stop and remove old containers with environment suffixes
5. Start new containers with unified names
6. Verify runtime configuration loads correctly
7. Clean up old Docker images with deprecated tags

## Troubleshooting

**Wrong image tag pulled:**
- Check `ENV` value in .env file (must be exactly `development` or `production`)
- Run `docker compose config` to verify image resolution

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
