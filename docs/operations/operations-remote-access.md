# Remote Access and Debugging

This document provides procedures for accessing TronRelic servers, inspecting running services, and debugging issues remotely. Use these techniques for routine monitoring, incident response, and troubleshooting.

## Why This Matters

**Risk of inadequate remote access procedures:**
- Production incidents extend when developers can't quickly access servers
- Missing debugging techniques force trial-and-error problem solving
- Unstructured log inspection wastes time during critical outages
- Lack of monitoring procedures prevents proactive issue detection

**Benefits of standardized remote access:**
- Quick SSH access reduces mean time to resolution (MTTR)
- Documented debugging procedures enable systematic troubleshooting
- Centralized log inspection techniques improve incident analysis
- Routine monitoring scripts catch issues before users report them

## SSH Access Procedures

### Basic SSH Connection

**Connect to production:**
```bash
ssh root@<PROD_DROPLET_IP>

# Once connected, navigate to deployment directory
cd /opt/tronrelic
```

**Connect to development:**
```bash
ssh root@<DEV_DROPLET_IP>

# Once connected, navigate to deployment directory
cd /opt/tronrelic-dev
```

**SSH connection troubleshooting:**
```bash
# Connection timeout or refused
# - Verify droplet is running (check Digital Ocean console)
# - Verify firewall allows port 22: ufw status
# - Verify your IP isn't blocked: ssh -vvv root@<IP>

# Permission denied (publickey)
# - Verify SSH key is added: ssh-add -l
# - Verify correct key file: ssh -i ~/.ssh/id_ed25519 root@<IP>
# - Verify key is authorized on server: cat ~/.ssh/authorized_keys
```

### SSH Configuration for Convenience

**Add to ~/.ssh/config for shorthand access:**
```
# Production
Host tronrelic-prod
    HostName <PROD_DROPLET_IP>
    User root
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 3

# Development
Host tronrelic-dev
    HostName <DEV_DROPLET_IP>
    User root
    IdentityFile ~/.ssh/id_ed25519
    ServerAliveInterval 60
    ServerAliveCountMax 3
```

**Connect using alias:**
```bash
ssh tronrelic-prod
ssh tronrelic-dev
```

### Execute Remote Commands Without Interactive Shell

**Run single command and return to local shell:**
```bash
# Check container status
ssh root@<DROPLET_IP> 'cd /opt/tronrelic && docker compose ps'

# View last 50 log lines
ssh root@<DROPLET_IP> 'cd /opt/tronrelic && docker compose logs --tail=50 backend'

# Check disk usage
ssh root@<DROPLET_IP> 'df -h'

# Check memory usage
ssh root@<DROPLET_IP> 'free -h'
```

**Use deployment scripts for common tasks:**
```bash
# View comprehensive server statistics

# Production
./scripts/utils/droplet-stats.sh prod

# Development
./scripts/utils/droplet-stats.sh dev

# Defaults to prod if no argument provided
./scripts/utils/droplet-stats.sh
```

## Docker Container Management

### Container Status and Health

**View all containers:**
```bash
# On server
docker compose ps

# Example output:
# NAME                     STATUS                    PORTS
# tronrelic-backend-prod   Up 2 hours (healthy)      0.0.0.0:4000->4000/tcp
# tronrelic-frontend-prod  Up 2 hours (healthy)      0.0.0.0:3000->3000/tcp
# tronrelic-mongo-prod     Up 2 hours (healthy)      0.0.0.0:27017->27017/tcp
# tronrelic-redis-prod     Up 2 hours (healthy)      0.0.0.0:6379->6379/tcp
```

**View container resource usage:**
```bash
# Real-time stats (press Ctrl+C to exit)
docker stats

# One-time snapshot
docker stats --no-stream

# Specific containers only
docker stats tronrelic-backend-prod tronrelic-frontend-prod

# Example output:
# CONTAINER           CPU %    MEM USAGE / LIMIT     MEM %    NET I/O
# tronrelic-backend   12.5%    850MB / 2GB           42.5%    1.2GB / 850MB
# tronrelic-frontend  3.2%     420MB / 1GB           42.0%    450MB / 200MB
```

**Check container health status:**
```bash
# View health check details
docker inspect tronrelic-backend-prod --format='{{.State.Health.Status}}'
# Output: healthy | starting | unhealthy

# View full health check logs
docker inspect tronrelic-backend-prod --format='{{json .State.Health}}' | jq
```

**Test health endpoints directly:**
```bash
# Backend health check (direct)
curl http://localhost:4000/api/health
# Expected: {"status":"ok","timestamp":"..."}

# Frontend health check (tests frontend's health & integration with backend)
curl http://localhost:3000/api/health
# Expected: {"status":"ok","timestamp":"..."}

# Via Nginx reverse proxy (external URL)
curl http://localhost/api/health
curl https://tronrelic.com/api/health  # Production
curl http://dev.tronrelic.com/api/health  # Development
```

### Container Lifecycle Management

**Restart containers:**
```bash
# Restart all containers
docker compose restart

# Restart specific container
docker compose restart backend
docker compose restart frontend

# Restart with fresh pull (get latest images)
docker compose pull
docker compose down
docker compose up -d
```

**Stop containers:**
```bash
# Stop all containers (preserves data in volumes)
docker compose down

# Stop and remove volumes (WARNING: deletes database data)
docker compose down -v

# Stop specific container
docker compose stop backend
```

**Start containers:**
```bash
# Start all containers
docker compose up -d

# Start specific containers
docker compose up -d backend redis mongodb

# Start in foreground (logs visible, Ctrl+C to stop)
docker compose up
```

**Rebuild containers (after config changes):**
```bash
# Rebuild and restart (after .env changes)
docker compose up -d --force-recreate

# Rebuild from scratch (after docker-compose.yml changes)
docker compose down
docker compose up -d
```

### Execute Commands Inside Containers

**Interactive shell access:**
```bash
# Backend container shell
docker exec -it tronrelic-backend-prod sh

# Frontend container shell
docker exec -it tronrelic-frontend-prod sh

# MongoDB shell
docker exec -it tronrelic-mongo-prod mongosh tronrelic

# Redis shell
docker exec -it tronrelic-redis-prod redis-cli

# Exit container shell
exit  # or Ctrl+D
```

**Run single command in container:**
```bash
# Check Node.js version in backend
docker exec tronrelic-backend-prod node --version

# List files in frontend
docker exec tronrelic-frontend-prod ls -la /app

# Check MongoDB collections (see MongoDB Access section below for full details)
docker exec -i -e MONGO_PASSWORD='your-password' tronrelic-mongo-prod sh -c \
  'mongosh --username admin --password "$MONGO_PASSWORD" --authenticationDatabase admin --quiet --eval "db.getCollectionNames()" tronrelic-prod'

# Check Redis memory usage
docker exec tronrelic-redis-prod redis-cli info memory
```

## Log Inspection and Analysis

### Docker Compose Logs

**View logs for all containers:**
```bash
# Follow logs (real-time, press Ctrl+C to exit)
docker compose logs -f

# Show last 100 lines and follow
docker compose logs --tail=100 -f

# Show logs without following
docker compose logs

# Show last 50 lines only
docker compose logs --tail=50
```

**View logs for specific container:**
```bash
# Backend logs
docker compose logs -f backend

# Frontend logs
docker compose logs -f frontend

# MongoDB logs
docker compose logs -f mongodb

# Redis logs
docker compose logs -f redis
```

**Filter logs by timestamp:**
```bash
# Logs since specific time
docker compose logs --since 2024-01-15T10:00:00

# Logs in last 30 minutes
docker compose logs --since 30m

# Logs in last 2 hours
docker compose logs --since 2h

# Logs between timestamps
docker compose logs --since 2024-01-15T10:00:00 --until 2024-01-15T11:00:00
```

**Search logs for specific patterns:**
```bash
# Search for errors
docker compose logs backend | grep -i error

# Search for specific API endpoint
docker compose logs backend | grep "GET /api/transactions"

# Search for errors in last hour
docker compose logs --since 1h backend | grep -i error

# Count error occurrences
docker compose logs backend | grep -i error | wc -l
```

**Export logs to file for offline analysis:**
```bash
# Export all logs
docker compose logs > /tmp/tronrelic-logs.txt

# Export backend logs only
docker compose logs backend > /tmp/backend-logs.txt

# Export logs with timestamps
docker compose logs --timestamps backend > /tmp/backend-logs-$(date +%Y%m%d-%H%M%S).txt
```

### Application-Specific Debugging

**Backend debugging:**
```bash
# Check backend environment variables
docker exec tronrelic-backend-prod env | grep -E "NODE_ENV|MONGODB|REDIS|TRONGRID"

# Check backend health endpoint
curl http://localhost:4000/api/health

# Test backend API directly
curl http://localhost:4000/api/transactions?limit=10

# Check backend worker jobs (BullMQ)
docker exec tronrelic-redis-prod redis-cli KEYS "tronrelic:*"

# View backend memory usage
docker exec tronrelic-backend-prod node -e "console.log(process.memoryUsage())"
```

**Frontend debugging:**
```bash
# Check frontend environment variables
docker exec tronrelic-frontend-prod env | grep NEXT_PUBLIC

# Check frontend build info
docker exec tronrelic-frontend-prod cat /app/.next/BUILD_ID

# Test frontend directly (bypassing Nginx)
curl http://localhost:3000/

# Check frontend memory usage
docker exec tronrelic-frontend-prod node -e "console.log(process.memoryUsage())"
```

**MongoDB debugging:**

Remote droplets require authentication. Use the connection instructions in the "MongoDB Access" section below.

For local development without authentication:
```bash
# Connect to MongoDB shell (local only, no auth required)
docker exec -it tronrelic-mongo mongosh tronrelic
```

Once connected to mongosh, you can run these queries:
```javascript
// Show databases
show dbs

// Show collections
show collections

// Count documents in transactions collection
db.transactions.countDocuments()

// Find recent transactions
db.transactions.find().sort({timestamp: -1}).limit(10)

// Check database stats
db.stats()

// Exit mongosh
exit
```

**Redis debugging:**
```bash
# Connect to Redis CLI (with authentication)
docker exec -it tronrelic-redis-prod redis-cli

# Inside redis-cli (authenticate first if password required):
AUTH <REDIS_PASSWORD>

# View all keys
KEYS *

# View TronRelic-specific keys
KEYS tronrelic:*

# View queue status
LLEN "tronrelic:block-sync:wait"

# View Redis memory usage
INFO memory

# View Redis stats
INFO stats

# Exit redis-cli
exit
```

## Database Access and Management

### MongoDB Access

**Connect to MongoDB with authentication:**

For authenticated MongoDB instances (production and development with `--auth` enabled), use the full connection syntax:

```bash
# Production - Get password from server .env first
ssh root@<PROD_DROPLET_IP> 'grep MONGO_ROOT_PASSWORD /opt/tronrelic/.env'

# Then connect using password in environment variable (prevents exposure in process list)
ssh root@<PROD_DROPLET_IP> 'cd /opt/tronrelic && \
  docker exec -i -e MONGO_PASSWORD="<paste-password-here>" tronrelic-mongo-prod sh -c \
  "mongosh --username admin --password \"\$MONGO_PASSWORD\" --authenticationDatabase admin tronrelic-prod"'

# Development - Same pattern
ssh root@<DEV_DROPLET_IP> 'grep MONGO_ROOT_PASSWORD /opt/tronrelic-dev/.env'

ssh root@<DEV_DROPLET_IP> 'cd /opt/tronrelic-dev && \
  docker exec -i -e MONGO_PASSWORD="<paste-password-here>" tronrelic-mongo-dev sh -c \
  "mongosh --username admin --password \"\$MONGO_PASSWORD\" --authenticationDatabase admin tronrelic"'
```

**Key flags explained:**
- `--username admin` - MongoDB root user (created during initialization)
- `--password "$MONGO_PASSWORD"` - Password from `MONGO_ROOT_PASSWORD` in .env
- `--authenticationDatabase admin` - Admin database where root user credentials are stored (required!)
- `-e MONGO_PASSWORD="..."` - Pass via environment variable to avoid exposing password in process lists
- `-i` - Interactive mode (needed for mongosh to function properly)

**Common MongoDB queries:**
```javascript
// View all collections
db.getCollectionNames()

// Count total transactions
db.transactions.countDocuments()

// Find recent whale transactions
db.transactions.find({ value: { $gt: 1000000 } }).sort({ timestamp: -1 }).limit(10)

// Find transactions for specific address
db.transactions.find({ "from": "TRX_ADDRESS_HERE" }).limit(10)

// View database indexes
db.transactions.getIndexes()

// View database size
db.stats(1024*1024)  // Size in MB

// Drop a specific collection (BE CAREFUL!)
db.oldCollection.drop()
```

**Export MongoDB data:**

Remote droplets require authentication. Authentication flags must be added to mongodump/mongoexport commands:

```bash
# Export entire database (from remote droplet)
PASS=$(ssh root@<DROPLET_IP> 'grep MONGO_ROOT_PASSWORD /opt/tronrelic*/\.env | cut -d= -f2') && \
ssh root@<DROPLET_IP> "cd /opt/tronrelic* && \
  docker exec -i -e MONGO_PASSWORD='$PASS' tronrelic-mongo-* sh -c \
  'mongodump --username admin --password \"\\\$MONGO_PASSWORD\" --authenticationDatabase admin --out /tmp/backup'"

# Copy backup to local machine
ssh root@<DROPLET_IP> 'cd /opt/tronrelic* && docker cp tronrelic-mongo-*:/tmp/backup /tmp/backup-$(date +%Y%m%d)'
scp -r root@<DROPLET_IP>:/tmp/backup-* ./mongo-backup-$(date +%Y%m%d)

# Export specific collection (from remote droplet)
PASS=$(ssh root@<DROPLET_IP> 'grep MONGO_ROOT_PASSWORD /opt/tronrelic*/\.env | cut -d= -f2') && \
ssh root@<DROPLET_IP> "cd /opt/tronrelic* && \
  docker exec -i -e MONGO_PASSWORD='$PASS' tronrelic-mongo-* sh -c \
  'mongoexport --username admin --password \"\\\$MONGO_PASSWORD\" --authenticationDatabase admin --db=tronrelic --collection=transactions --out=/tmp/transactions.json'"
```

**Import MongoDB data:**

```bash
# Copy backup to container (from local machine to remote droplet)
scp -r ./mongo-backup root@<DROPLET_IP>:/tmp/restore

# Restore database (with authentication)
PASS=$(ssh root@<DROPLET_IP> 'grep MONGO_ROOT_PASSWORD /opt/tronrelic*/\.env | cut -d= -f2') && \
ssh root@<DROPLET_IP> "cd /opt/tronrelic* && \
  docker exec -i -e MONGO_PASSWORD='$PASS' tronrelic-mongo-* sh -c \
  'mongorestore --username admin --password \"\\\$MONGO_PASSWORD\" --authenticationDatabase admin /tmp/restore'"

# Import specific collection (with authentication)
PASS=$(ssh root@<DROPLET_IP> 'grep MONGO_ROOT_PASSWORD /opt/tronrelic*/\.env | cut -d= -f2') && \
ssh root@<DROPLET_IP> "cd /opt/tronrelic* && \
  docker cp ./transactions.json tronrelic-mongo-*:/tmp/transactions.json && \
  docker exec -i -e MONGO_PASSWORD='$PASS' tronrelic-mongo-* sh -c \
  'mongoimport --username admin --password \"\\\$MONGO_PASSWORD\" --authenticationDatabase admin --db=tronrelic --collection=transactions --file=/tmp/transactions.json'"
```

### Redis Access

**Connect to Redis CLI:**
```bash
# Connect with authentication
docker exec -it tronrelic-redis-prod redis-cli -a <REDIS_PASSWORD>

# Or connect first, then authenticate
docker exec -it tronrelic-redis-prod redis-cli
# Inside redis-cli: AUTH <REDIS_PASSWORD>
```

**Common Redis commands:**
```bash
# Inside redis-cli

# View all keys
KEYS *

# View TronRelic queue keys
KEYS tronrelic:block-sync:*

# View queue length
LLEN "tronrelic:block-sync:wait"

# View queue contents (first 10 items)
LRANGE "tronrelic:block-sync:wait" 0 9

# View key value
GET "tronrelic:some-key"

# View key type
TYPE "tronrelic:block-sync:wait"

# View all info
INFO

# View memory usage
INFO memory

# View connected clients
CLIENT LIST

# Flush all keys (BE CAREFUL! This clears ALL data)
# FLUSHALL

# Flush TronRelic keys only (safer)
# redis-cli KEYS "tronrelic:*" | xargs redis-cli DEL
```

**Monitor Redis operations in real-time:**
```bash
# Watch all Redis commands (Ctrl+C to stop)
docker exec -it tronrelic-redis-prod redis-cli MONITOR

# Watch commands matching pattern
docker exec -it tronrelic-redis-prod redis-cli --ldb MONITOR | grep "tronrelic:"
```

## System Monitoring and Diagnostics

### Server Resource Monitoring

**Use the comprehensive stats script:**
```bash
# From local machine
./scripts/utils/droplet-stats.sh <env>

# Production
./scripts/utils/droplet-stats.sh prod

# Development
./scripts/utils/droplet-stats.sh dev

# Example output includes:
# - System information (OS, CPU cores, total RAM/disk)
# - Disk usage with color-coded bars
# - Memory usage with recommendations
# - CPU load averages
# - Docker container stats
# - Docker disk usage
# - Database volume sizes
# - Service health checks
# - Container status
# - Recommendations for resource cleanup
```

**Manual resource checks on server:**
```bash
# Disk usage
df -h

# Disk usage by directory
du -sh /opt/tronrelic/*
du -sh /var/lib/docker/*

# Memory usage
free -h

# CPU usage
top -bn1 | head -20

# Load averages
uptime

# Process list sorted by memory
ps aux --sort=-%mem | head -10

# Process list sorted by CPU
ps aux --sort=-%cpu | head -10
```

### Network Diagnostics

**Test network connectivity:**
```bash
# Test backend from frontend container
docker exec tronrelic-frontend-prod curl http://backend:4000/api/health

# Test MongoDB from backend container
docker exec tronrelic-backend-prod nc -zv mongodb 27017

# Test Redis from backend container
docker exec tronrelic-backend-prod nc -zv redis 6379

# Test external TronGrid API
docker exec tronrelic-backend-prod curl -I https://api.trongrid.io/
```

**Check open ports:**
```bash
# On server
sudo netstat -tulpn | grep -E "3000|4000|27017|6379"

# Or with ss (modern alternative)
sudo ss -tulpn | grep -E "3000|4000|27017|6379"

# Expected output:
# tcp   LISTEN   0.0.0.0:3000   # Frontend
# tcp   LISTEN   0.0.0.0:4000   # Backend
# tcp   LISTEN   0.0.0.0:27017  # MongoDB
# tcp   LISTEN   0.0.0.0:6379   # Redis
```

**Verify Nginx configuration:**
```bash
# Test Nginx configuration syntax
sudo nginx -t

# View Nginx status
sudo systemctl status nginx

# Reload Nginx (after config changes)
sudo systemctl reload nginx

# View Nginx error log
sudo tail -f /var/log/nginx/error.log

# View Nginx access log
sudo tail -f /var/log/nginx/access.log
```

### Application Monitoring

**System monitor dashboard:**
```bash
# Access admin dashboard from browser
https://tronrelic.com/system  # Production
http://dev.tronrelic.com/system  # Development

# Or via curl with admin token
curl -H "x-admin-token: <ADMIN_API_TOKEN>" https://tronrelic.com/api/admin/system/overview

# Response includes:
# - Blockchain sync status (current block, lag, sync speed)
# - Transaction indexing statistics
# - Block processing performance
# - API queue depth and errors
# - Scheduler job status
# - Database connection health
# - Redis queue status
```

**Monitor blockchain sync progress:**
```bash
# Check current block height
curl http://localhost:4000/api/health | jq .blockchain.currentBlock

# Check sync lag
curl http://localhost:4000/api/health | jq .blockchain.lag

# Monitor sync in real-time (watch command refreshes every 2 seconds)
watch -n 2 'curl -s http://localhost:4000/api/health | jq .blockchain'
```

## Troubleshooting Common Issues

### Container Restart Loops

**Symptom:** Container continuously restarts and never becomes healthy

**Diagnosis:**
```bash
# Check container status
docker compose ps

# View container logs
docker compose logs --tail=100 backend

# Check exit code
docker inspect tronrelic-backend-prod --format='{{.State.ExitCode}}'
```

**Common causes:**
- **Exit code 1:** Application error (check logs for stack trace)
- **Exit code 137:** Out of memory (increase memory limit)
- **Exit code 139:** Segmentation fault (corrupted dependencies, rebuild image)

**Solutions:**
```bash
# Increase memory limit in docker-compose.yml
services:
  backend:
    environment:
      - NODE_OPTIONS=--max-old-space-size=4096  # Increase from 2048

# Restart with fresh pull
docker compose pull
docker compose down
docker compose up -d

# Check resource usage
docker stats --no-stream
```

### Database Connection Errors

**Symptom:** Backend logs show "MongoNetworkError" or "Redis connection refused"

**Diagnosis:**
```bash
# Check database containers are running
docker compose ps mongodb redis

# Check database logs
docker compose logs mongodb
docker compose logs redis

# Test connection from backend
docker exec tronrelic-backend-prod nc -zv mongodb 27017
docker exec tronrelic-backend-prod nc -zv redis 6379
```

**Solutions:**
```bash
# Verify credentials in .env match docker-compose.yml
cat .env | grep -E "MONGO|REDIS"

# Restart database containers
docker compose restart mongodb redis

# Restart backend (depends on databases)
docker compose restart backend
```

### High Memory or CPU Usage

**Symptom:** Server becomes slow, containers use excessive resources

**Diagnosis:**
```bash
# Check container resource usage
docker stats --no-stream

# Check system memory
free -h

# Check top processes
top -bn1 | head -20
```

**Solutions:**
```bash
# Restart memory-intensive container
docker compose restart backend

# Clear Redis cache (if queue buildup)
docker exec tronrelic-redis-prod redis-cli FLUSHALL

# Clean up Docker resources
docker system prune -a  # Removes unused images, containers, networks

# Upgrade server resources (last resort)
# - Resize Digital Ocean droplet to larger plan
# - Update docker-compose.yml memory limits
```

### Nginx 502 Bad Gateway

**Symptom:** Frontend or backend returns 502 error via Nginx

**Diagnosis:**
```bash
# Check backend/frontend are running
docker compose ps backend frontend

# Test backend directly (bypass Nginx)
curl http://localhost:4000/api/health

# Test frontend directly
curl http://localhost:3000/

# Check Nginx error log
sudo tail -f /var/log/nginx/error.log
```

**Solutions:**
```bash
# Restart backend/frontend
docker compose restart backend frontend

# Reload Nginx
sudo systemctl reload nginx

# Verify Nginx proxy configuration
sudo nginx -t
sudo cat /etc/nginx/sites-available/tronrelic
```

## Quick Reference

**Connect to servers:**
```bash
ssh root@<PROD_DROPLET_IP>  # Production
ssh root@<DEV_DROPLET_IP>      # Development
```

**Container management:**
```bash
docker compose ps              # Status
docker compose logs -f         # Logs
docker compose restart         # Restart all
docker compose down && up -d   # Fresh restart
```

**Database access (remote droplets require authentication):**
```bash
# See MongoDB Access section for full authenticated connection commands
# For local development:
docker exec -it tronrelic-mongo mongosh tronrelic
docker exec -it tronrelic-redis redis-cli
```

**Resource monitoring:**
```bash
./scripts/utils/droplet-stats.sh <env>  # Comprehensive stats
docker stats --no-stream                 # Container resources
df -h && free -h                         # Disk and memory
```

**Health checks:**
```bash
curl http://localhost:4000/api/health  # Backend (direct)
curl http://localhost:3000/api/health  # Frontend + backend integration
curl https://tronrelic.com/system      # System monitor
```

## Further Reading

- [operations-server-info.md](./operations-server-info.md) - Server locations, credentials, authentication
- [operations-workflows.md](./operations-workflows.md) - Setup and update procedures
- [operations.md](./operations.md) - Deployment overview and quick reference
- [system-api.md](../system/system-api.md) - API endpoints and health check documentation
