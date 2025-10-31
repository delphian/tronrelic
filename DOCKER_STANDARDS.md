# TronRelic Docker Standards

## Single Environment Variable Convention

All TronRelic deployments use a **single environment identifier** that controls both Docker image tags and Node.js runtime configuration.

### Allowed Values

Only two values are permitted:
- `ENV=development` - Development/staging environments
- `ENV=production` - Production environments

### How It Works

**Docker Compose Configuration:**
```yaml
services:
  backend:
    image: ghcr.io/delphian/tronrelic/backend:${ENV}
    environment:
      - NODE_ENV=${ENV}
```

**Result:**
- `ENV=development` → Pulls `:development` image, sets `NODE_ENV=development`
- `ENV=production` → Pulls `:production` image, sets `NODE_ENV=production`

---

## Image Tagging Convention

### Development Builds (dev branch)

**Requirements:**
- MUST tag images as `:development` only
- NO additional tags (`:dev`, `:latest`, etc.)

**GitHub Actions Example:**
```yaml
- name: Build and push development images
  run: |
    docker build --target backend -t ghcr.io/delphian/tronrelic/backend:development .
    docker build --target frontend-prod -t ghcr.io/delphian/tronrelic/frontend:development .
    docker push ghcr.io/delphian/tronrelic/backend:development
    docker push ghcr.io/delphian/tronrelic/frontend:development
```

### Production Builds (main branch)

**Requirements:**
- MUST tag images as `:production` only
- NO dual-tagging with `:latest`
- NO additional tags

**Rationale:** Single tag eliminates ambiguity and prevents accidental deployments with wrong tags.

**GitHub Actions Example:**
```yaml
- name: Build and push production images
  run: |
    docker build --target backend -t ghcr.io/delphian/tronrelic/backend:production .
    docker build --target frontend-prod -t ghcr.io/delphian/tronrelic/frontend:production .
    docker push ghcr.io/delphian/tronrelic/backend:production
    docker push ghcr.io/delphian/tronrelic/frontend:production
```

---

## Deployment Convention

All servers use the same deployment directory and process:

```bash
# Deployment directory (all environments)
/opt/tronrelic/

# Configuration file (manually placed by administrator)
/opt/tronrelic/.env

# Deployment command (same for all environments)
cd /opt/tronrelic
docker compose up -d
```

**Environment differentiation via .env file:**

```bash
# Development server .env
ENV=development
SITE_URL=https://dev.tronrelic.com
# ... other dev-specific values

# Production server .env
ENV=production
SITE_URL=https://tronrelic.com
# ... other prod-specific values
```

**Future:** Watchers on servers will automatically pull updated Docker images and restart containers, eliminating manual deployment steps.

---

## Container Naming Convention

All environments use identical container names (no suffixes):

```yaml
services:
  mongodb:
    container_name: tronrelic-mongo
  redis:
    container_name: tronrelic-redis
  backend:
    container_name: tronrelic-backend
  frontend:
    container_name: tronrelic-frontend
```

**Benefits:**
- Simplified scripts (no environment-specific container references)
- Consistent monitoring and debugging commands
- Reduced configuration errors

---

## Volume Naming Convention

All environments use identical volume names:

```yaml
volumes:
  tronrelic-mongo-data:
    driver: local
  tronrelic-redis-data:
    driver: local
```

**Benefits:**
- Consistent backup and restore procedures
- Simplified volume management commands
- Clear data ownership

---

## Benefits

✅ **Reduced Complexity** - 3 variables (ENV, IMAGE_TAG, NODE_ENV) consolidated to 1
✅ **Industry Standard** - Aligns with Node.js `NODE_ENV` conventions
✅ **Clear Intent** - `development` and `production` are explicit and unambiguous
✅ **Single Source of Truth** - One variable controls all environment behavior
✅ **Fewer Configuration Errors** - Less chance of IMAGE_TAG/NODE_ENV mismatch
✅ **No Tag Ambiguity** - Single tags (`:development`, `:production`) eliminate confusion
✅ **Unified .env Template** - Single example file works for all environments
✅ **Streamlined Deployment** - Minimal environment-specific script logic
✅ **Runtime Configuration** - Frontend uses backend API config (no NEXT_PUBLIC_* variables)

---

## Migration Notes

**Existing Tags:**
- Old `:dev` tags may still exist in registry (deprecated, not used after migration)
- Old `:latest` tags may still exist in registry (deprecated, not used after migration)
- Clean up old tags after migration is verified stable

**Required Changes:**
- CI/CD workflows must implement new tagging convention (`:development`, `:production` only)
- Deployment scripts must use `ENV` instead of `IMAGE_TAG` and `NODE_ENV`
- docker-compose.yml must reference `${ENV}` for image tags and NODE_ENV
- .env files manually placed by administrators (not via CI/CD)
- Frontend removes NEXT_PUBLIC_* variables, uses runtime config from backend API

**Timeline:**
- CI/CD updates must be deployed before unified docker-compose.yml
- Old images with deprecated tags can be cleaned up after migration complete
- Future: Implement watcher-based deployment (pulls images automatically)

---

## Security Considerations

### Required Secrets

**Generate with:** `openssl rand -hex 32`

- `ADMIN_API_TOKEN` - Access to /system monitoring endpoint
- `MONGO_ROOT_PASSWORD` - MongoDB authentication
- `REDIS_PASSWORD` - Redis authentication

### Best Practices

- Never commit .env files to version control
- Use strong, unique passwords for each environment
- Rotate credentials periodically
- Enable authentication on all remote deployments
- Use TLS/SSL for production deployments

---

## Troubleshooting

### Common Issues

**Wrong image tag pulled:**
- Check `ENV` value in .env file
- Must be exactly `development` or `production`

**Container name conflicts:**
- Stop old containers with environment suffixes
- Remove old containers: `docker rm tronrelic-*-prod tronrelic-*-dev`

**Volume migration:**
- Copy data from old volumes to new unified names
- Keep old volumes as backup until verified

**Authentication failures:**
- Ensure MONGO_ROOT_PASSWORD and REDIS_PASSWORD are set
- Check connection strings include credentials

---

## Quick Reference

### Environment Setup

```bash
# Development
ENV=development
SITE_URL=https://dev.tronrelic.com

# Production
ENV=production
SITE_URL=https://tronrelic.com
```

### Container Names

- `tronrelic-mongo`
- `tronrelic-redis`
- `tronrelic-backend`
- `tronrelic-frontend`

### Image Tags

- Development: `ghcr.io/delphian/tronrelic/*:development`
- Production: `ghcr.io/delphian/tronrelic/*:production`

### Deployment Directory

All environments: `/opt/tronrelic/`