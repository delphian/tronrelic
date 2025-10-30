# TronRelic Unified Operations Plan

**Status:** Proposed
**Created:** 2025-01-30
**Goal:** Consolidate Docker Compose configuration to eliminate environment-specific drift while preserving all production data

---

## Executive Summary

**Current Problem:**
- 4 Docker Compose files causing configuration drift (npm, dev, prod, local)
- Environment-specific naming creates complexity (container suffixes, volume suffixes)
- Dev environment lacks authentication (security inconsistency)
- Different deployment paths (`/opt/tronrelic` vs `/opt/tronrelic-dev`)

**Proposed Solution:**
- Consolidate to 2 files: `docker-compose.npm.yml` (local npm mode) and `docker-compose.yml` (universal)
- Unified naming: same containers, volumes, and directory paths across all environments
- Required authentication everywhere (dev and prod both use passwords)
- Single-variable approach: `ENV=development` or `ENV=production` (replaces IMAGE_TAG and NODE_ENV)
- Standardized Docker image tagging convention (`:development` and `:production` only)
- Environment differentiation via `.env` files placed manually by administrators
- Single `.env.example` template with clear sections for both environments
- Unified Nginx configuration with domain-based differentiation
- Streamlined deployment scripts with minimal environment-specific logic

**Critical Constraint:**
**PRODUCTION DATA MUST REMAIN INTACT AND IN PLACE.** All migration steps prioritize zero data loss.

---

## Current State Analysis

### Deployment Paths

| Environment | Current Path | Proposed Path | Change Required |
|-------------|--------------|---------------|-----------------|
| **Production** | `/opt/tronrelic` | `/opt/tronrelic` | ✅ No change |
| **Development** | `/opt/tronrelic-dev` | `/opt/tronrelic` | ⚠️ Rename directory |
| **Local Docker** | (repo root) | (repo root) | ✅ No change |
| **Local npm** | (repo root) | (repo root) | ✅ No change |

### Container Names

| Service | Production (Current) | Development (Current) | Unified (Proposed) |
|---------|---------------------|----------------------|-------------------|
| MongoDB | `tronrelic-mongo-prod` | `tronrelic-mongo-dev` | `tronrelic-mongo` |
| Redis | `tronrelic-redis-prod` | `tronrelic-redis-dev` | `tronrelic-redis` |
| Backend | `tronrelic-backend-prod` | `tronrelic-backend-dev` | `tronrelic-backend` |
| Frontend | `tronrelic-frontend-prod` | `tronrelic-frontend-dev` | `tronrelic-frontend` |

### Volume Names

| Service | Production (Current) | Development (Current) | Unified (Proposed) |
|---------|---------------------|----------------------|-------------------|
| MongoDB Data | `tronrelic-mongo-prod-data` | `tronrelic-mongo-dev-data` | `tronrelic-mongo-data` |
| MongoDB Config | `tronrelic-mongo-prod-config` ❌ | (none) | **Remove entirely** |
| Redis Data | `tronrelic-redis-prod-data` | `tronrelic-redis-dev-data` | `tronrelic-redis-data` |

**✅ RESOLVED - MongoDB Config Volume Investigation:**
The `/data/configdb` volume in production is **unnecessary and should be removed**. This directory is exclusively for MongoDB sharded cluster config servers. TronRelic runs MongoDB as a single-node deployment, which never writes to `/data/configdb`—all data goes to `/data/db` regardless. The volume remains empty and unused in production, wasting disk space. Remove from docker-compose.prod.yml to match dev/local configurations and eliminate configuration drift.

### Authentication Status

| Environment | MongoDB Auth | Redis Auth | Status |
|-------------|-------------|-----------|--------|
| **Production** | ✅ Required | ✅ Required | Secure |
| **Development** | ❌ None | ❌ None | **Insecure** |
| **Local Docker** | ❌ None | ❌ None | Acceptable (localhost only) |
| **Local npm** | ❌ None | ❌ None | Acceptable (localhost only) |

**Post-Migration:** All remote deployments (prod and dev) will require authentication. Local development environments may continue without authentication for convenience.

### Docker Compose Files

| File | Purpose | Status After Migration |
|------|---------|----------------------|
| `docker-compose.yml` | Local full-stack Docker | **Keep** - Make universal |
| `docker-compose.npm.yml` | Local npm mode (DB only) | **Keep** - No changes |
| `docker-compose.dev.yml` | Dev server deployment | **Delete** - Replaced by unified |
| `docker-compose.prod.yml` | Prod server deployment | **Delete** - Replaced by unified |

---

## Proposed Unified Architecture

### Unified Naming Convention

**All environments use identical names:**
```
Deployment Directory: /opt/tronrelic
Container Prefix:     tronrelic-
Volume Prefix:        tronrelic-
```

**Environment differentiation via:**
- Physical isolation (separate droplets)
- `.env` files placed manually by administrators (single `ENV` variable controls everything)
- Standardized image tags (`:development` and `:production` only, no `:latest` or dual-tagging)
- Authentication credentials (required for all remote deployments)

**Single-Variable Convention:**
- `ENV=development` → Uses `:development` image tag, sets `NODE_ENV=development`
- `ENV=production` → Uses `:production` image tag, sets `NODE_ENV=production`

### Unified docker-compose.yml Structure

```yaml
services:
  mongodb:
    image: mongo:6
    container_name: tronrelic-mongo
    environment:
      - MONGO_INITDB_ROOT_USERNAME=${MONGO_ROOT_USERNAME}
      - MONGO_INITDB_ROOT_PASSWORD=${MONGO_ROOT_PASSWORD}
    volumes:
      - tronrelic-mongo-data:/data/db
    command: ["mongod", "--auth"]

  redis:
    image: redis:7-alpine
    container_name: tronrelic-redis
    environment:
      - REDIS_PASSWORD=${REDIS_PASSWORD}
    volumes:
      - tronrelic-redis-data:/data
    command: >
      redis-server --requirepass ${REDIS_PASSWORD} --appendonly yes

  backend:
    image: ghcr.io/delphian/tronrelic/backend:${ENV}
    container_name: tronrelic-backend
    environment:
      - NODE_ENV=${ENV}
      - MONGODB_URI=mongodb://${MONGO_ROOT_USERNAME}:${MONGO_ROOT_PASSWORD}@mongodb:27017/tronrelic?authSource=admin
      - REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379
      - SITE_URL=${SITE_URL}
      # SITE_URL is the single source of truth (required)
      # ... other env vars (ADMIN_API_TOKEN, TRONGRID_API_KEYs, etc.)

  frontend:
    image: ghcr.io/delphian/tronrelic/frontend:${ENV}
    container_name: tronrelic-frontend
    environment:
      - NODE_ENV=${ENV}
      - API_URL=http://backend:4000
      # NOTE: NEXT_PUBLIC_* variables removed
      # Runtime config is fetched from backend API and injected via SSR
      # See docs/system/system-runtime-config.md for details

volumes:
  tronrelic-mongo-data:
  tronrelic-redis-data:
```

### Environment Configuration Files

**Single .env.example Template**

Administrators will create and maintain environment-specific `.env` files on each server based on this unified template. CI/CD jobs must **not** overwrite these files; the one-time manual setup (and any future secret rotation) stays with the administrator.

```bash
# ============================================
# TronRelic Environment Configuration
# ============================================
# Copy this file to .env on your server and fill in values

# ------------------------------
# Single Environment Identifier
# ------------------------------
# Controls Docker image tag and NODE_ENV
# Set ONE of these values (do not set both):
ENV=development  # For dev.tronrelic.com
# ENV=production   # For tronrelic.com

# ------------------------------
# Site Configuration
# ------------------------------
# SITE_URL is required. Backend and frontend read this directly; there is no database fallback.
# Development server:
SITE_URL=https://dev.tronrelic.com
# Production server:
# SITE_URL=https://tronrelic.com

# ------------------------------
# Database Authentication (REQUIRED)
# ------------------------------
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=<generate-with-openssl-rand-hex-32>
REDIS_PASSWORD=<generate-with-openssl-rand-hex-32>

# Database Connection Strings
MONGODB_URI=mongodb://admin:${MONGO_ROOT_PASSWORD}@mongodb:27017/tronrelic?authSource=admin
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# ------------------------------
# Backend Configuration
# ------------------------------
PORT=4000
ENABLE_SCHEDULER=true
ENABLE_WEBSOCKETS=true

# ------------------------------
# Admin Access
# ------------------------------
# Generate with: openssl rand -hex 32
ADMIN_API_TOKEN=<generate-with-openssl-rand-hex-32>

# ------------------------------
# TronGrid API Keys
# ------------------------------
# Get from https://www.trongrid.io/
TRONGRID_API_KEY=<key1>
TRONGRID_API_KEY_2=<key2>
TRONGRID_API_KEY_3=<key3>
```

**SITE_URL enforcement:** Both backend and frontend builds will read the `.env` `SITE_URL` directly; SystemConfigService and runtimeConfig will no longer fall back to database values. Deployments must fail fast if `SITE_URL` is missing.

**Deployment Process:**
1. Administrator manually creates `.env` file on each server
2. Fills in environment-specific values (ENV, SITE_URL, credentials)
3. `.env` file remains in place across deployments
4. Future: Watchers on servers will pull Docker image updates automatically

---

## Migration Strategy

### Phase 1: Preparation (No Downtime)

**1.1 Create Unified .env Template**
- [ ] Create single `.env.example` in repository
- [ ] Include clear sections for both development and production
- [ ] Document all required variables with inline comments
- [ ] Remove or update existing separate .env templates

**1.2 Update docker-compose.yml**
- [ ] Make universal with environment variable support
- [ ] Remove hardcoded environment-specific values
- [ ] Add authentication requirements for all environments
- [ ] Use `${ENV}` for image tags and NODE_ENV
- [ ] Remove NEXT_PUBLIC_* variables from frontend (use runtime config instead)
- [ ] Ensure backend reads SITE_URL directly for SystemConfigService defaults
- [x] ~~Investigate if MongoDB configdb volume is necessary~~ - **RESOLVED: Remove entirely (unnecessary for single-node MongoDB)**

**1.3 Update Deployment Scripts**
- [ ] **IMPORTANT:** Audit ALL scripts for hardcoded container name references BEFORE migration:
  ```bash
  grep -r "tronrelic-.*-prod\|tronrelic-.*-dev" scripts/
  ```
- [ ] `scripts/droplet-config.sh`:
  - Remove `CONTAINER_SUFFIX`, `IMAGE_TAG` exports
  - Unify deploy directory to `/opt/tronrelic`
  - Simplify container name exports (remove suffixes)
  - Update ALL container name references to new unified names
  - Keep helper functions (remote_exec, mongo_exec, etc.)
- [ ] `scripts/droplet-deploy.sh` - Use unified compose file and manually-placed .env
- [ ] `scripts/droplet-update.sh`:
  - Use unified compose file
  - Assume .env already exists on server (no copying)
  - Add note about future watcher-based deployment
- [ ] `scripts/droplet-setup-nginx.sh` - Unify Nginx config (domain-based only)

**1.4 Update CI/CD**
- [ ] `.github/workflows/docker-publish-dev.yml`:
  - Update to tag images as `:development` only
  - **REMOVE automatic deployment steps** - dev deployment will now be manual via `scripts/droplet-update.sh` just like production
  - Investigate frontend build target (dev uses frontend-prod target?)
- [ ] `.github/workflows/docker-publish-prod.yml`:
  - Update to tag images as `:production` only (no `:latest`)
  - Confirm no deployment steps present (already manual)
- [ ] Test workflow in feature branch
- [ ] Document future watcher-based deployment approach

**1.5 Create Docker Standards Document**
- [ ] Create `DOCKER_STANDARDS.md` documenting single-variable convention
- [ ] Document image tagging requirements: `:development` and `:production` only
- [ ] Document allowed ENV values (development, production)
- [ ] Clarify NO dual-tagging or `:latest` usage

**1.6 Test on Local**
- [ ] Generate test passwords for dev/prod configs
- [ ] Test unified docker-compose.yml locally with `ENV=development`
- [ ] Test unified docker-compose.yml locally with `ENV=production`
- [ ] Verify all services start and authenticate correctly
- [ ] Verify correct image tags pulled (`:development` vs `:production`)

### Phase 2: Development Server Migration (Data Not Preserved)

**Risk:** Low - Development data is expendable per requirements
**Note:** Existing development data will be lost during this migration. This is acceptable as dev data is not production-critical.

**2.1 Backup Current Dev State (Optional)**
```bash
ssh root@<DEV_IP>
cd /opt/tronrelic-dev
docker compose -f docker-compose.dev.yml down
tar -czf ~/tronrelic-dev-backup-$(date +%Y%m%d).tar.gz /opt/tronrelic-dev
```

**2.2 Deploy Unified Configuration**
```bash
# On dev droplet
cd /opt
mv tronrelic-dev tronrelic-dev.old
mkdir tronrelic
cd tronrelic

# Copy unified docker-compose.yml from repo
scp docker-compose.yml root@<DEV_IP>:/opt/tronrelic/

# Generate new auth credentials
openssl rand -hex 32  # MONGO_ROOT_PASSWORD
openssl rand -hex 32  # REDIS_PASSWORD

# Manually create .env file based on .env.example
# (Administrators place .env manually, not via CI/CD)
cat > .env << EOF
ENV=development
SITE_URL=https://dev.tronrelic.com
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=<paste-generated-password>
REDIS_PASSWORD=<paste-generated-password>
MONGODB_URI=mongodb://admin:\${MONGO_ROOT_PASSWORD}@mongodb:27017/tronrelic?authSource=admin
REDIS_URL=redis://:\${REDIS_PASSWORD}@redis:6379
PORT=4000
ENABLE_SCHEDULER=true
ENABLE_WEBSOCKETS=true
ADMIN_API_TOKEN=<paste-admin-token>
TRONGRID_API_KEY=<key1>
TRONGRID_API_KEY_2=<key2>
TRONGRID_API_KEY_3=<key3>
EOF

# Start with unified config
docker compose up -d
```

**2.3 Verify Dev Deployment**
- [ ] Check all containers running: `docker compose ps`
- [ ] Test backend health: `curl http://localhost:4000/api/health`
- [ ] Test frontend: `curl http://localhost:3000`
- [ ] Verify authentication working: Try connecting to MongoDB/Redis with password
- [ ] Test application functionality

**2.4 Update DNS/Nginx (if needed)**
- [ ] Verify nginx still proxies to correct ports
- [ ] Test public access at https://dev.tronrelic.com

**2.5 Cleanup Old Dev Installation**
```bash
# After confirming new setup works
rm -rf /opt/tronrelic-dev.old
docker volume prune  # Remove old dev volumes
```

### Phase 3: Production Server Migration (CRITICAL - Data Preservation Required)

**Risk:** Medium - Requires careful volume migration to preserve data

**⚠️ CRITICAL REQUIREMENTS:**
1. Production data must not be lost
2. Old volumes must remain as backup until verification complete
3. Rollback plan must be tested before migration
4. Maintenance window should be scheduled

**3.1 Pre-Migration Verification**
```bash
ssh root@<PROD_IP>

# Check current data size
docker exec tronrelic-mongo-prod du -sh /data/db
docker exec tronrelic-redis-prod du -sh /data

# Verify current volumes exist
docker volume ls | grep prod

# Expected output:
# tronrelic-mongo-prod-data
# tronrelic-mongo-prod-config
# tronrelic-redis-prod-data

# Check current service health
docker compose -f docker-compose.prod.yml ps
curl http://localhost:4000/api/health
```

**3.2 Create Full Backup (Safety Net)**
```bash
# Create backup directory
mkdir -p /root/backups/tronrelic-$(date +%Y%m%d)
cd /root/backups/tronrelic-$(date +%Y%m%d)

# Backup MongoDB
docker exec tronrelic-mongo-prod mongodump \
  --username admin \
  --password "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --out /backup
docker cp tronrelic-mongo-prod:/backup ./mongo-backup

# Backup Redis
docker exec tronrelic-redis-prod redis-cli \
  -a "$REDIS_PASSWORD" \
  --no-auth-warning \
  SAVE
docker cp tronrelic-redis-prod:/data/dump.rdb ./redis-backup/

# Backup .env file
cp /opt/tronrelic/.env ./.env.backup

# Backup current docker-compose.prod.yml
cp /opt/tronrelic/docker-compose.prod.yml ./docker-compose.prod.yml.backup
```

**3.3 Copy Data to Unified Volume Names (With Planned Downtime)**

This approach keeps old volumes as backup while creating new volumes with unified names.
**Note:** Brief downtime (5-10 minutes) is acceptable and planned for this migration to ensure data integrity during volume copy:

```bash
cd /opt/tronrelic

# Step 1: Stop ALL containers (brief downtime is acceptable to protect data integrity)
docker stop tronrelic-backend-prod tronrelic-frontend-prod tronrelic-mongo-prod tronrelic-redis-prod

# Step 2: Create new volumes with unified names
docker volume create tronrelic-mongo-data
docker volume create tronrelic-mongo-config
docker volume create tronrelic-redis-data

# Step 3: Copy MongoDB data volume
docker run --rm \
  -v tronrelic-mongo-prod-data:/source:ro \
  -v tronrelic-mongo-data:/dest \
  alpine sh -c "cp -av /source/. /dest/"

# Step 4: Copy MongoDB config volume
docker run --rm \
  -v tronrelic-mongo-prod-config:/source:ro \
  -v tronrelic-mongo-config:/dest \
  alpine sh -c "cp -av /source/. /dest/"

# Step 5: Copy Redis data volume
docker run --rm \
  -v tronrelic-redis-prod-data:/source:ro \
  -v tronrelic-redis-data:/dest \
  alpine sh -c "cp -av /source/. /dest/"

# Step 6: Verify data copied successfully
docker run --rm -v tronrelic-mongo-data:/data alpine ls -lah /data
docker run --rm -v tronrelic-mongo-config:/data alpine ls -lah /data
docker run --rm -v tronrelic-redis-data:/data alpine ls -lah /data
```

**3.4 Deploy Unified Configuration**

```bash
cd /opt/tronrelic

# Stop all old containers
docker compose -f docker-compose.prod.yml down

# Verify old containers stopped
docker ps -a | grep tronrelic

# Deploy unified configuration
# (Assumes new docker-compose.yml and .env.prod already copied to server)
docker compose --env-file .env.prod up -d

# Watch logs for startup
docker compose logs -f
```

**3.5 Verify Production Migration**

```bash
# Check all containers running with new names
docker compose ps
# Expected: tronrelic-mongo, tronrelic-redis, tronrelic-backend, tronrelic-frontend

# Verify volumes mounted correctly
docker inspect tronrelic-mongo | grep -A 10 Mounts
docker inspect tronrelic-redis | grep -A 10 Mounts

# Test backend health
curl http://localhost:4000/api/health

# Test frontend
curl http://localhost:3000

# Verify authentication still working
docker exec tronrelic-mongo mongosh \
  --username admin \
  --password "$MONGO_ROOT_PASSWORD" \
  --authenticationDatabase admin \
  --eval "db.adminCommand('ping')"

docker exec tronrelic-redis redis-cli \
  -a "$REDIS_PASSWORD" \
  --no-auth-warning \
  PING

# Check database collections still exist
docker exec -e MONGO_PASSWORD="$MONGO_ROOT_PASSWORD" tronrelic-mongo sh -c \
  'mongosh --username admin --password "$MONGO_PASSWORD" --authenticationDatabase admin tronrelic --eval "db.getCollectionNames()"'

# Verify blockchain sync status via API
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" \
  http://localhost:4000/api/admin/system/blockchain/status

# Test public access
curl https://tronrelic.com
curl https://tronrelic.com/api/health
```

**3.6 Post-Migration Monitoring (24-48 Hours)**

- [ ] Monitor logs for errors: `docker compose logs -f`
- [ ] Check system dashboard at https://tronrelic.com/system
- [ ] Verify blockchain sync continuing normally
- [ ] Verify market data refreshing
- [ ] Monitor disk usage (ensure no runaway logs)
- [ ] Check application metrics/error rates

**3.7 Cleanup Old Volumes (After Verification Period)**

**⚠️ ONLY DELETE AFTER 48+ HOURS OF STABLE OPERATION**

```bash
# Final verification before deletion
docker volume ls | grep prod

# Delete old volumes (THIS IS PERMANENT)
docker volume rm tronrelic-mongo-prod-data
docker volume rm tronrelic-mongo-prod-config
docker volume rm tronrelic-redis-prod-data

# Verify deletion
docker volume ls
```

---

## Rollback Procedures

### Rollback Development (Low Risk)

**If new dev setup fails:**
```bash
ssh root@<DEV_IP>
cd /opt
docker compose -f /opt/tronrelic/docker-compose.yml down
mv tronrelic tronrelic.failed
mv tronrelic-dev.old tronrelic-dev
cd tronrelic-dev
docker compose -f docker-compose.dev.yml up -d
```

**Note:** .env file is in deployment directory and loaded automatically by docker compose.

**Timeframe:** 5 minutes

### Rollback Production (CRITICAL)

**Scenario A: Rollback Before Volume Deletion (Recommended)**

If old volumes still exist (`tronrelic-mongo-prod-data`, etc.), rollback is simple:

```bash
ssh root@<PROD_IP>
cd /opt/tronrelic

# Stop new containers
docker compose down

# Restore old compose file from backup
cp /root/backups/tronrelic-YYYYMMDD/docker-compose.prod.yml.backup ./docker-compose.prod.yml

# Restore old .env file
cp /root/backups/tronrelic-YYYYMMDD/.env.backup ./.env

# Start with old configuration (uses old volume names)
docker compose -f docker-compose.prod.yml up -d

# Verify services running
docker compose -f docker-compose.prod.yml ps
curl http://localhost:4000/api/health
```

**Timeframe:** 5-10 minutes
**Data Loss:** None (old volumes unchanged)

**Scenario B: Rollback After Volume Deletion (Emergency)**

If old volumes deleted and new setup catastrophically fails:

```bash
ssh root@<PROD_IP>
cd /root/backups/tronrelic-YYYYMMDD

# Restore backup compose file
cp docker-compose.prod.yml.backup /opt/tronrelic/docker-compose.prod.yml
cd /opt/tronrelic

# Recreate old volumes
docker volume create tronrelic-mongo-prod-data
docker volume create tronrelic-mongo-prod-config
docker volume create tronrelic-redis-prod-data

# Restore MongoDB from backup
docker run --rm \
  -v tronrelic-mongo-prod-data:/data/db \
  -v /root/backups/tronrelic-YYYYMMDD/mongo-backup:/backup \
  mongo:6 \
  mongorestore --username admin --password "$MONGO_ROOT_PASSWORD" --authenticationDatabase admin /backup

# Restore Redis from backup
docker run --rm \
  -v tronrelic-redis-prod-data:/data \
  -v /root/backups/tronrelic-YYYYMMDD/redis-backup:/backup \
  alpine cp /backup/dump.rdb /data/

# Start with old configuration
docker compose -f docker-compose.prod.yml up -d

# Verify restoration
curl http://localhost:4000/api/health
```

**Timeframe:** 15-30 minutes (depends on database size)
**Data Loss:** Transactions between backup and rollback (potentially hours)

---

## File Change Checklist

### Files to Create

- [ ] `UNIFIED_OPERATIONS_PLAN.md` (this document)
- [ ] `DOCKER_STANDARDS.md` - Single-variable convention documentation
- [ ] Update `.env.example` - Single unified template with clear sections for both environments

### Files to Modify

**Docker Compose:**
- [ ] `docker-compose.yml` - Make universal with single `${ENV}` variable
  - Update image tags: `ghcr.io/delphian/tronrelic/backend:${ENV}`
  - Update NODE_ENV: `NODE_ENV=${ENV}`
- [ ] Keep `docker-compose.npm.yml` unchanged

**Scripts:**
- [ ] `scripts/droplet-config.sh`
  - Remove `CONTAINER_SUFFIX` variable
  - Remove environment-specific deploy directory logic
  - Update container name exports to remove suffix
- [ ] `scripts/droplet-deploy.sh`
  - Update to use unified compose file path
  - Remove dynamic compose generation (use repo file instead)
  - Add `--env-file` flag to docker compose commands
- [ ] `scripts/droplet-update.sh`
  - Update to copy unified `docker-compose.yml` instead of env-specific files
  - Add `--env-file` flag to docker compose commands

**CI/CD:**
- [ ] `.github/workflows/docker-publish-dev.yml`
  - Update image tagging to use `:development` only
  - **REMOVE ALL automatic deployment steps** (lines 51-103 currently deploy via SSH - this must be removed)
  - Dev deployment will now be manual via `scripts/droplet-update.sh dev` just like production
  - Investigate frontend build target inconsistency (uses frontend-prod?)
- [ ] `.github/workflows/docker-publish-prod.yml`
  - Update image tagging to use `:production` only (no `:latest` dual-tagging)
  - Remove deployment steps if present (future: watcher-based deployment)

**Documentation:**
- [ ] `README.md` - Update Docker deployment section
- [ ] `docs/operations/operations.md` - Update deployment architecture
- [ ] `docs/operations/operations-workflows.md` - Update deployment procedures
- [ ] `docs/environment.md` - Update environment variable documentation

### Files to Delete (After Migration Complete)

- [ ] `docker-compose.dev.yml`
- [ ] `docker-compose.prod.yml`

---

## Testing Checklist

### Pre-Migration Testing

**Local Environment:**
- [ ] Generate test passwords for `.env.dev` and `.env.prod`
- [ ] Test `docker-compose.yml --env-file .env.dev` locally
- [ ] Test `docker-compose.yml --env-file .env.prod` locally
- [ ] Verify MongoDB authentication works with both configs
- [ ] Verify Redis authentication works with both configs
- [ ] Verify backend connects to authenticated databases
- [ ] Verify frontend connects to backend

**Development Server (Dry Run):**
- [ ] Deploy unified config to dev server
- [ ] Verify all services start
- [ ] Verify authentication works
- [ ] Test application functionality
- [ ] Test rollback procedure on dev

### Post-Migration Testing

**Development Server:**
- [ ] All containers running with unified names
- [ ] MongoDB authentication enforced
- [ ] Redis authentication enforced
- [ ] Backend API responding
- [ ] Frontend rendering
- [ ] WebSocket connections working
- [ ] Blockchain sync running
- [ ] Market data refreshing

**Production Server:**
- [ ] All containers running with unified names
- [ ] Old volumes still exist as backup
- [ ] MongoDB data preserved (check collection counts)
- [ ] Redis data preserved (check key counts)
- [ ] Authentication still working
- [ ] Backend API responding
- [ ] Frontend rendering
- [ ] WebSocket connections working
- [ ] Blockchain sync continuing from last block
- [ ] Market data refreshing
- [ ] Admin dashboard accessible
- [ ] User accounts accessible
- [ ] Transaction history intact

---

## Risk Assessment

### Development Server Migration

**Risk Level:** ✅ Low

**Reasons:**
- Data preservation not required
- Easy rollback (rename directories)
- Can be tested multiple times
- No user impact if fails

**Mitigation:**
- Test locally first
- Keep old directory as backup initially
- Schedule during low-usage hours

### Production Server Migration

**Risk Level:** ⚠️ Medium

**Reasons:**
- Volume migration required
- Potential for data corruption during copy
- Brief service interruption during container restart
- Authentication changes could lock out services

**Mitigation:**
- Full backup before migration
- Copy volumes while databases running (zero downtime)
- Keep old volumes as backup (don't delete immediately)
- Test rollback procedure on dev first
- Schedule during maintenance window
- Monitor closely for 48 hours post-migration

**Critical Safeguards:**
1. Old volumes remain intact throughout migration
2. Full backup stored in `/root/backups/`
3. Rollback procedure tested on dev first
4. Maintenance window scheduled for production
5. Team available to monitor post-migration

---

## Timeline Estimates

### Development Server Migration
- Preparation: 30 minutes
- Execution: 15 minutes
- Verification: 15 minutes
- **Total:** 1 hour

### Production Server Migration
- Preparation: 1 hour (backup, verification)
- Volume Copy: 5-10 minutes (while services running)
- Container Restart: 2-3 minutes (brief downtime)
- Verification: 30 minutes
- Post-Migration Monitoring: 48 hours
- **Total Active Work:** 2 hours
- **Total Timeline:** 48+ hours (monitoring period)

---

## Success Criteria

**Development Server:**
- [ ] All containers running with unified names
- [ ] Authentication required and working
- [ ] Application fully functional
- [ ] Deploy path is `/opt/tronrelic`

**Production Server:**
- [ ] All containers running with unified names
- [ ] All production data preserved and accessible
- [ ] Zero data loss (verified via collection/key counts)
- [ ] Authentication still working with existing credentials
- [ ] Blockchain sync continuing from correct block
- [ ] Market data up-to-date
- [ ] Zero increase in error rates
- [ ] All API endpoints responding normally

**Repository:**
- [ ] Only 2 compose files remain: `docker-compose.yml` and `docker-compose.npm.yml`
- [ ] All deployment scripts use unified configuration
- [ ] CI/CD updated with new tagging convention (`:development` and `:production`)
- [ ] Single `ENV` variable convention implemented everywhere
- [ ] `DOCKER_STANDARDS.md` created and documented
- [ ] Documentation updated

---

## Approval Required

Before proceeding with this migration plan:

- [ ] Review and approve unified architecture design
- [ ] Review and approve migration strategy
- [ ] Review and approve risk mitigation measures
- [ ] Schedule production maintenance window
- [ ] Confirm backup strategy acceptable
- [ ] Confirm rollback procedures understood
- [ ] Assign team member for monitoring

**Approved By:** _______________________
**Date:** _______________________

---

## Appendix A: Current Configuration Differences

### docker-compose.dev.yml vs docker-compose.prod.yml

**Differences:**
1. **Image tags:** `:dev` vs `:latest`
2. **Container names:** `-dev` suffix vs `-prod` suffix
3. **Volume names:** `-dev` suffix vs `-prod` suffix
4. **Authentication:** None vs Required
5. **Resource limits:** None vs CPU/Memory limits
6. **Logging:** Default vs Constrained (10-50MB, 3-5 files)
7. **Restart policy:** `unless-stopped` vs `always`
8. **MongoDB command:** No auth vs `--auth` flag
9. **Redis command:** No password vs `--requirepass`
10. **Healthchecks:** Unauthenticated vs Authenticated
11. **Connection strings:** Simple vs Authenticated

### Proposed Unified Configuration Differences (Single-Variable Approach)

**Only these differ between dev and prod:**
1. **Single environment variable** (via `.env.dev` vs `.env.prod`):
   - `ENV` (development vs production) - Controls both image tag and NODE_ENV
   - `SITE_URL` (dev.tronrelic.com vs tronrelic.com)
   - Password values (different credentials)
   - API keys (dev vs prod credentials)
2. **Physical isolation** (different droplet IPs)

**Everything else identical.**

**Key improvement:** Reduced from 3 environment identifiers (ENV, IMAGE_TAG, NODE_ENV) to 1 (ENV).

---

## Appendix B: Unified Environment File Template

### .env.example (Single Unified Template)

```bash
# ============================================
# TronRelic Environment Configuration
# ============================================
# Copy this file to .env on your server and fill in values
# This single template works for both development and production

# ------------------------------
# Single Environment Identifier
# ------------------------------
# Controls Docker image tag and NODE_ENV
# Set ONE of these values (uncomment the one you need):

# Development server (dev.tronrelic.com):
ENV=development

# Production server (tronrelic.com):
# ENV=production

# ------------------------------
# Site Configuration
# ------------------------------
# Set the URL that matches your environment:

# Development server:
SITE_URL=https://dev.tronrelic.com

# Production server:
# SITE_URL=https://tronrelic.com

# ------------------------------
# Database Authentication (REQUIRED)
# ------------------------------
# Generate passwords with: openssl rand -hex 32
# Production: USE EXISTING CREDENTIALS

MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=<generate-or-use-existing>
REDIS_PASSWORD=<generate-or-use-existing>

# Database Connection Strings
MONGODB_URI=mongodb://admin:${MONGO_ROOT_PASSWORD}@mongodb:27017/tronrelic?authSource=admin
REDIS_URL=redis://:${REDIS_PASSWORD}@redis:6379

# ------------------------------
# Backend Configuration
# ------------------------------
PORT=4000
ENABLE_SCHEDULER=true
ENABLE_WEBSOCKETS=true

# ------------------------------
# Admin Access
# ------------------------------
# Generate with: openssl rand -hex 32
# Production: USE EXISTING TOKEN

ADMIN_API_TOKEN=<generate-or-use-existing>

# ------------------------------
# TronGrid API Keys
# ------------------------------
# Get from https://www.trongrid.io/
# Production: USE EXISTING KEYS

TRONGRID_API_KEY=<api-key-1>
TRONGRID_API_KEY_2=<api-key-2>
TRONGRID_API_KEY_3=<api-key-3>
```

**Usage:**
1. Copy `.env.example` to `.env` on target server
2. Uncomment and set `ENV` (development or production)
3. Set `SITE_URL` matching your domain
4. Generate new passwords (dev) or use existing (prod)
5. Fill in API keys
6. Place in `/opt/tronrelic/.env` manually (not via CI/CD)

---

## Appendix C: Post-Migration Verification Script

```bash
#!/usr/bin/env bash
# verify-migration.sh
# Run this script after migration to verify everything works

set -euo pipefail

ENV=${1:-prod}
echo "Verifying $ENV migration..."

# Check containers running
echo "Checking containers..."
CONTAINERS=$(docker compose ps --format json | jq -r '.[].Name')
EXPECTED=("tronrelic-mongo" "tronrelic-redis" "tronrelic-backend" "tronrelic-frontend")

for container in "${EXPECTED[@]}"; do
    if echo "$CONTAINERS" | grep -q "$container"; then
        echo "✓ $container running"
    else
        echo "✗ $container NOT RUNNING"
        exit 1
    fi
done

# Check volumes
echo "Checking volumes..."
VOLUMES=$(docker volume ls --format '{{.Name}}')
EXPECTED_VOLS=("tronrelic-mongo-data" "tronrelic-mongo-config" "tronrelic-redis-data")

for vol in "${EXPECTED_VOLS[@]}"; do
    if echo "$VOLUMES" | grep -q "$vol"; then
        echo "✓ $vol exists"
    else
        echo "✗ $vol NOT FOUND"
        exit 1
    fi
done

# Check health endpoints
echo "Checking API health..."
if curl -sf http://localhost:4000/api/health > /dev/null; then
    echo "✓ Backend API healthy"
else
    echo "✗ Backend API not responding"
    exit 1
fi

echo "Checking frontend..."
if curl -sf http://localhost:3000 > /dev/null; then
    echo "✓ Frontend responding"
else
    echo "✗ Frontend not responding"
    exit 1
fi

# Check database authentication
echo "Checking MongoDB authentication..."
if docker exec tronrelic-mongo mongosh \
    --username admin \
    --password "$MONGO_ROOT_PASSWORD" \
    --authenticationDatabase admin \
    --eval "db.adminCommand('ping')" > /dev/null 2>&1; then
    echo "✓ MongoDB authentication working"
else
    echo "✗ MongoDB authentication failed"
    exit 1
fi

echo "Checking Redis authentication..."
if docker exec tronrelic-redis redis-cli \
    -a "$REDIS_PASSWORD" \
    --no-auth-warning \
    PING | grep -q "PONG"; then
    echo "✓ Redis authentication working"
else
    echo "✗ Redis authentication failed"
    exit 1
fi

echo ""
echo "✓ All verification checks passed!"
```

---

## Appendix D: Docker Standards Document

The following standards must be enforced to maintain the single-variable convention.

### DOCKER_STANDARDS.md (To Be Created)

```markdown
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
```

---

## Document History

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2025-01-30 | System | Initial unified operations plan |
| 1.1 | 2025-01-30 | System | Updated to single-variable approach (ENV only) |
| 1.2 | 2025-01-30 | System | Additional simplifications: removed dual-tagging, unified .env.example, removed NEXT_PUBLIC_* variables, added future watcher-based deployment notes, investigated MongoDB configdb volume necessity, clarified manual .env placement by administrators |
| 1.3 | 2025-01-30 | System | Resolved MongoDB configdb volume investigation: confirmed unnecessary for single-node deployments, removed from unified configuration |

---

## Summary of Key Simplifications (Version 1.2)

The following additional simplifications were incorporated based on code review and architectural analysis:

1. **Single .env Template** - Consolidated `.env.dev.example` and `.env.prod.example` into single `.env.example` with clear sections for both environments
2. **No Dual-Tagging** - Eliminated `:latest` dual-tagging requirement; production uses only `:production` tag
3. **Runtime Configuration System** - Removed `NEXT_PUBLIC_*` variables from frontend Docker config; uses backend API runtime config instead (SystemConfigService)
4. **Manual .env Placement** - .env files placed manually by administrators on servers, not pushed via CI/CD
5. **Future Watcher Architecture** - Documented planned watcher-based deployment where servers automatically pull updated images
6. **Streamlined Deployment Scripts** - Removed ~50 lines of environment-specific logic from `droplet-config.sh` by unifying paths and container names
7. **Unified Nginx Configuration** - Single Nginx template with domain-based differentiation only
8. **MongoDB Config Volume Resolution** - Removed `/data/configdb` volume from unified config (unnecessary for single-node MongoDB deployments)
9. **Frontend Build Target** - Flagged inconsistency where dev workflow uses `frontend-prod` build target
10. **Authentication Required** - Confirmed all remote deployments (prod and dev) require database authentication; local dev may skip for convenience
