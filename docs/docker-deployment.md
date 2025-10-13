# Docker Deployment Guide

This guide covers Docker deployment strategies for TronRelic using a multi-stage build architecture that separates backend and frontend services.

## Architecture Overview

TronRelic uses a **multi-container Docker architecture** with separate images for backend and frontend services:

```
┌─────────────────────────────────────────────────────────────┐
│                     Docker Network                           │
│                                                               │
│  ┌──────────────┐  ┌──────────────┐  ┌───────────────┐     │
│  │   MongoDB    │  │    Redis     │  │   Backend     │     │
│  │              │  │              │  │   (Node.js)   │     │
│  │  Port: 27017 │  │  Port: 6379  │  │  Port: 4000   │     │
│  └──────────────┘  └──────────────┘  └───────────────┘     │
│         │                  │                   │             │
│         └──────────────────┴───────────────────┘             │
│                            │                                 │
│                    ┌───────────────┐                         │
│                    │   Frontend    │                         │
│                    │  (Next.js)    │                         │
│                    │  Port: 3000   │                         │
│                    └───────────────┘                         │
│                                                               │
└─────────────────────────────────────────────────────────────┘
```

### Why Separate Images?

The architecture separates backend and frontend into independent images because:

1. **Plugin Architecture Compatibility**
   - Plugins contain BOTH backend and frontend code in `packages/plugins/`
   - Backend consumes compiled plugin backends (`dist/backend/backend.js`)
   - Frontend imports source plugin frontends (`src/frontend/frontend.ts`)
   - Shared build stage compiles plugins once, both images reuse artifacts

2. **Independent Scaling**
   - Scale backend API separately from frontend SSR
   - Backend handles blockchain sync, WebSocket, and database operations
   - Frontend serves pages and handles user interactions

3. **Deployment Flexibility**
   - Deploy backend updates without rebuilding frontend
   - Deploy frontend updates without rebuilding backend
   - Rollback services independently

4. **Resource Optimization**
   - Backend image: ~200-300MB (Node.js + compiled code)
   - Frontend image: ~150-250MB (Node.js + Next.js)
   - Smaller than combined image (~500MB+)

## Build Stages

The [Dockerfile](../Dockerfile) uses a multi-stage build strategy:

### Stage 1: Base Dependencies
- Sets up Node.js 20 Alpine base
- Copies `package.json` files to establish workspace structure
- Prepares for dependency installation

### Stage 2: Shared Builder
- Installs all dependencies (dev + production)
- Builds `@tronrelic/types` (framework-independent interfaces)
- Builds `@tronrelic/shared` (runtime utilities)
- Compiles plugin backends and frontends
- **This stage is reused by both backend and frontend images**

### Stage 3: Backend Image
- Installs production dependencies only
- Copies compiled artifacts from shared builder
- Builds backend application
- Runs Express + Socket.IO + BullMQ workers
- Health check endpoint: `http://localhost:4000/api/health`

### Stage 4: Frontend Dev Image
- Installs all dependencies (dev mode needs devDependencies)
- Copies types and plugin source from shared builder
- Runs Next.js in development mode with Turbopack
- Supports hot module reloading

### Stage 5: Frontend Production Image
- Installs all dependencies for build
- Copies types and plugin source from shared builder
- Builds Next.js for production (static optimization)
- Prunes dev dependencies to reduce image size
- Health check endpoint: `http://localhost:3000/api/health`

## Environment Configuration

### Development Environment

Create `.env` in project root:

```bash
# Required - Generate with: openssl rand -hex 32
ADMIN_API_TOKEN=your_secure_admin_token_here

# Required - Get from https://www.trongrid.io/
TRONGRID_API_KEY=your_trongrid_key_1
TRONGRID_API_KEY_2=your_trongrid_key_2
TRONGRID_API_KEY_3=your_trongrid_key_3

# Optional: Telegram Integration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_WEBHOOK_SECRET=your_webhook_secret
```

The [docker-compose.yml](../docker-compose.yml) uses these environment variables and configures services for local development.

### Production Environment

For production, create `.env` with additional security settings:

```bash
# Required - Application Secrets
ADMIN_API_TOKEN=your_secure_admin_token_here
TRONGRID_API_KEY=your_trongrid_key_1
TRONGRID_API_KEY_2=your_trongrid_key_2
TRONGRID_API_KEY_3=your_trongrid_key_3

# Required - Database Security (PRODUCTION ONLY)
MONGO_ROOT_USERNAME=admin
MONGO_ROOT_PASSWORD=your_secure_mongo_password
REDIS_PASSWORD=your_secure_redis_password

# Optional: Telegram Integration
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
TELEGRAM_WEBHOOK_SECRET=your_webhook_secret

# Optional: Public URLs (customize for your domain)
NEXT_PUBLIC_API_URL=https://api.yourdomain.com/api
NEXT_PUBLIC_SOCKET_URL=https://api.yourdomain.com
NEXT_PUBLIC_SITE_URL=https://yourdomain.com
```

The [docker-compose.prod.yml](../docker-compose.prod.yml) enables MongoDB and Redis authentication for production security.

## Quick Start Commands

### Development

```bash
# Build and start all services
npm run docker:up

# View logs
npm run docker:logs

# Stop services
npm run docker:down
```

### Production

```bash
# Build production images
npm run docker:build:prod

# Start production services
npm run docker:up:prod

# View logs
docker compose -f docker-compose.prod.yml logs -f

# Stop services
npm run docker:down:prod
```

## Detailed Command Reference

### Building Images

```bash
# Build all images (development)
npm run docker:build
# Equivalent to: docker compose build

# Build all images (production)
npm run docker:build:prod
# Equivalent to: docker compose -f docker-compose.prod.yml build

# Build specific service
docker compose build backend
docker compose build frontend

# Build without cache (clean rebuild)
docker compose build --no-cache

# Build with progress output
docker compose build --progress=plain
```

### Starting Services

```bash
# Start all services in background (development)
npm run docker:up
# Equivalent to: docker compose up -d

# Start all services in background (production)
npm run docker:up:prod
# Equivalent to: docker compose -f docker-compose.prod.yml up -d

# Start with logs attached (foreground)
docker compose up

# Start specific services
docker compose up -d backend mongodb redis
docker compose up -d frontend

# Recreate containers (useful after config changes)
docker compose up -d --force-recreate
```

### Viewing Logs

```bash
# View all logs
npm run docker:logs
# Equivalent to: docker compose logs -f

# View backend logs only
npm run docker:logs:backend
# Equivalent to: docker compose logs -f backend

# View frontend logs only
npm run docker:logs:frontend
# Equivalent to: docker compose logs -f frontend

# View last 100 lines
docker compose logs --tail=100 backend

# View logs without following
docker compose logs backend
```

### Stopping Services

```bash
# Stop all services (development)
npm run docker:down
# Equivalent to: docker compose down

# Stop all services (production)
npm run docker:down:prod
# Equivalent to: docker compose -f docker-compose.prod.yml down

# Stop and remove volumes (WARNING: deletes data)
docker compose down -v

# Stop specific service
docker compose stop backend
```

### Maintenance Commands

```bash
# Clean rebuild (removes cache)
npm run docker:rebuild
# Equivalent to: docker compose down && docker compose build --no-cache && docker compose up -d

# Clean everything (containers + volumes + system)
npm run docker:clean
# Equivalent to: docker compose down -v && docker system prune -f

# Restart specific service
docker compose restart backend
docker compose restart frontend

# Execute command in running container
docker compose exec backend sh
docker compose exec frontend sh

# View container resource usage
docker stats tronrelic-backend tronrelic-frontend
```

### Database Access

```bash
# MongoDB shell
docker compose exec mongodb mongosh tronrelic

# MongoDB with authentication (production)
docker compose -f docker-compose.prod.yml exec mongodb mongosh -u admin -p

# Redis CLI
docker compose exec redis redis-cli

# Redis with authentication (production)
docker compose -f docker-compose.prod.yml exec redis redis-cli -a your_redis_password
```

## Health Checks

Both backend and frontend images include health checks:

### Backend Health Check
```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' tronrelic-backend

# View health check logs
docker inspect --format='{{json .State.Health}}' tronrelic-backend | jq
```

### Frontend Health Check
```bash
# Check health status
docker inspect --format='{{.State.Health.Status}}' tronrelic-frontend

# View health check logs
docker inspect --format='{{json .State.Health}}' tronrelic-frontend | jq
```

Health check intervals:
- **Interval**: 30 seconds
- **Timeout**: 10 seconds
- **Start period**: 40 seconds (allows services to initialize)
- **Retries**: 3 attempts before marking unhealthy

## Production Deployment Strategies

### Strategy 1: Single Server (Docker Compose)

Best for: Small to medium deployments, single server

```bash
# On production server, clone repository
git clone https://github.com/yourusername/tronrelic.git
cd tronrelic

# Create production .env file
nano .env
# (paste your production environment variables)

# Build and start services
npm run docker:build:prod
npm run docker:up:prod

# Verify services are healthy
docker compose -f docker-compose.prod.yml ps
```

### Strategy 2: Container Orchestration (Kubernetes)

Best for: High availability, horizontal scaling, multiple servers

Create Kubernetes manifests:

```yaml
# k8s/backend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tronrelic-backend
spec:
  replicas: 3
  selector:
    matchLabels:
      app: tronrelic-backend
  template:
    metadata:
      labels:
        app: tronrelic-backend
    spec:
      containers:
      - name: backend
        image: yourdockerhub/tronrelic-backend:latest
        ports:
        - containerPort: 4000
        env:
        - name: MONGODB_URI
          valueFrom:
            secretKeyRef:
              name: tronrelic-secrets
              key: mongodb-uri
        - name: REDIS_URL
          valueFrom:
            secretKeyRef:
              name: tronrelic-secrets
              key: redis-url
        - name: ADMIN_API_TOKEN
          valueFrom:
            secretKeyRef:
              name: tronrelic-secrets
              key: admin-token
        livenessProbe:
          httpGet:
            path: /api/health
            port: 4000
          initialDelaySeconds: 40
          periodSeconds: 30
        resources:
          limits:
            memory: "2Gi"
            cpu: "2000m"
          requests:
            memory: "1Gi"
            cpu: "1000m"
```

```yaml
# k8s/frontend-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: tronrelic-frontend
spec:
  replicas: 2
  selector:
    matchLabels:
      app: tronrelic-frontend
  template:
    metadata:
      labels:
        app: tronrelic-frontend
    spec:
      containers:
      - name: frontend
        image: yourdockerhub/tronrelic-frontend:latest
        ports:
        - containerPort: 3000
        env:
        - name: NEXT_PUBLIC_API_URL
          value: "https://api.yourdomain.com/api"
        - name: NEXT_PUBLIC_SOCKET_URL
          value: "https://api.yourdomain.com"
        livenessProbe:
          httpGet:
            path: /api/health
            port: 3000
          initialDelaySeconds: 40
          periodSeconds: 30
        resources:
          limits:
            memory: "1Gi"
            cpu: "1500m"
          requests:
            memory: "512Mi"
            cpu: "500m"
```

Deploy to Kubernetes:
```bash
kubectl apply -f k8s/
kubectl get pods
kubectl logs -f deployment/tronrelic-backend
```

### Strategy 3: Cloud Platforms

#### AWS ECS (Elastic Container Service)

1. Push images to Amazon ECR:
```bash
aws ecr create-repository --repository-name tronrelic-backend
aws ecr create-repository --repository-name tronrelic-frontend

docker tag tronrelic-backend:latest 123456789012.dkr.ecr.us-east-1.amazonaws.com/tronrelic-backend:latest
docker push 123456789012.dkr.ecr.us-east-1.amazonaws.com/tronrelic-backend:latest
```

2. Create ECS task definitions for backend and frontend
3. Set up Application Load Balancer
4. Configure auto-scaling policies

#### Google Cloud Run

```bash
# Build and push to Google Container Registry
docker build --target backend -t gcr.io/your-project/tronrelic-backend .
docker push gcr.io/your-project/tronrelic-backend

# Deploy to Cloud Run
gcloud run deploy tronrelic-backend \
  --image gcr.io/your-project/tronrelic-backend \
  --platform managed \
  --region us-central1 \
  --allow-unauthenticated
```

#### Azure Container Instances

```bash
# Create resource group
az group create --name tronrelic --location eastus

# Deploy backend container
az container create \
  --resource-group tronrelic \
  --name tronrelic-backend \
  --image yourdockerhub/tronrelic-backend:latest \
  --dns-name-label tronrelic-backend \
  --ports 4000
```

## Monitoring and Observability

### Container Monitoring

```bash
# View container resource usage
docker stats

# View container events
docker events

# Inspect container
docker inspect tronrelic-backend
```

### Application Monitoring

TronRelic includes built-in monitoring at `/system` endpoint:

```bash
# Access admin dashboard
curl -H "x-admin-token: your_admin_token" http://localhost:3000/system
```

**Metrics available:**
- Blockchain sync status and lag
- Transaction indexing statistics
- Block processing performance
- API queue depth and errors
- Scheduler job status

### Log Aggregation

For production deployments, configure log forwarding:

```yaml
# docker-compose.prod.yml logging configuration
services:
  backend:
    logging:
      driver: "json-file"
      options:
        max-size: "50m"
        max-file: "5"
```

Or use external log drivers:
```yaml
logging:
  driver: "syslog"
  options:
    syslog-address: "tcp://logs.example.com:514"
```

## Troubleshooting

### Container Won't Start

```bash
# Check container logs
docker compose logs backend

# Check container status
docker compose ps

# Inspect container exit code
docker inspect tronrelic-backend --format='{{.State.ExitCode}}'

# Run container interactively for debugging
docker compose run --rm backend sh
```

### Build Failures

```bash
# Build with verbose output
docker compose build --progress=plain

# Check disk space
df -h

# Clean Docker build cache
docker builder prune -a

# Force clean rebuild
npm run docker:rebuild
```

### Network Issues

```bash
# Inspect network
docker network inspect tronrelic_tronrelic-network

# Test connectivity between containers
docker compose exec frontend ping backend
docker compose exec backend ping mongodb

# Check port bindings
docker compose ps
netstat -tulpn | grep -E '3000|4000|27017|6379'
```

### Database Connection Errors

```bash
# Check MongoDB is running
docker compose ps mongodb

# Test MongoDB connection
docker compose exec mongodb mongosh --eval "db.adminCommand('ping')"

# Check Redis connection
docker compose exec redis redis-cli ping

# View MongoDB logs
docker compose logs mongodb

# View Redis logs
docker compose logs redis
```

### Performance Issues

```bash
# Check container resource limits
docker stats tronrelic-backend tronrelic-frontend

# Increase resource limits in docker-compose.prod.yml
services:
  backend:
    deploy:
      resources:
        limits:
          cpus: '4.0'
          memory: 4G

# Monitor application performance
curl -H "x-admin-token: your_admin_token" http://localhost:3000/system
```

### Volume Permissions

```bash
# Fix volume permissions
docker compose exec backend chown -R node:node /app

# Or rebuild with correct permissions
docker compose down -v
docker compose up -d
```

## Security Best Practices

### Production Checklist

- [ ] Generate strong secrets using `openssl rand -hex 32`
- [ ] Enable MongoDB authentication (set `MONGO_ROOT_USERNAME` and `MONGO_ROOT_PASSWORD`)
- [ ] Enable Redis authentication (set `REDIS_PASSWORD`)
- [ ] Use HTTPS/TLS for external connections
- [ ] Configure firewall rules (only expose ports 80/443)
- [ ] Use Docker secrets or Kubernetes secrets for sensitive data
- [ ] Enable container security scanning (Trivy, Snyk, etc.)
- [ ] Keep base images updated (`docker pull node:20-alpine`)
- [ ] Run containers as non-root user (already configured in Dockerfile)
- [ ] Enable Docker Content Trust: `export DOCKER_CONTENT_TRUST=1`
- [ ] Review and audit logs regularly
- [ ] Set up automated backups for MongoDB volumes

### Secrets Management

**Option 1: Docker Secrets (Swarm)**
```bash
echo "your_admin_token" | docker secret create admin_api_token -
docker service create --secret admin_api_token tronrelic-backend
```

**Option 2: Kubernetes Secrets**
```bash
kubectl create secret generic tronrelic-secrets \
  --from-literal=admin-token=your_admin_token \
  --from-literal=mongodb-uri=mongodb://...
```

**Option 3: External Secrets Manager**
- AWS Secrets Manager
- Google Secret Manager
- HashiCorp Vault
- Azure Key Vault

### Network Security

```yaml
# docker-compose.prod.yml - Restrict external access
services:
  mongodb:
    # DO NOT expose port in production
    # ports:
    #   - "27017:27017"  # Remove this line
    networks:
      - tronrelic-network

  backend:
    networks:
      - tronrelic-network
```

Use reverse proxy (Nginx, Traefik) for TLS termination and load balancing.

## Backup and Recovery

### Database Backups

```bash
# Backup MongoDB
docker compose exec mongodb mongodump --out=/backup
docker compose cp mongodb:/backup ./backups/

# Restore MongoDB
docker compose cp ./backups/backup mongodb:/restore
docker compose exec mongodb mongorestore /restore

# Automated backup script
cat > backup.sh << 'EOF'
#!/bin/bash
DATE=$(date +%Y%m%d_%H%M%S)
docker compose exec -T mongodb mongodump --archive | gzip > backups/mongodb_$DATE.gz
find backups/ -name "mongodb_*.gz" -mtime +7 -delete
EOF
chmod +x backup.sh
```

### Container Image Backups

```bash
# Save images to tar
docker save tronrelic-backend:latest | gzip > backend-image.tar.gz
docker save tronrelic-frontend:latest | gzip > frontend-image.tar.gz

# Load images from tar
docker load < backend-image.tar.gz
docker load < frontend-image.tar.gz
```

## CI/CD Integration

### GitHub Actions Example

```yaml
# .github/workflows/docker-build.yml
name: Build and Push Docker Images

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3

      - name: Set up Docker Buildx
        uses: docker/setup-buildx-action@v2

      - name: Login to Docker Hub
        uses: docker/login-action@v2
        with:
          username: ${{ secrets.DOCKER_USERNAME }}
          password: ${{ secrets.DOCKER_PASSWORD }}

      - name: Build and push backend
        uses: docker/build-push-action@v4
        with:
          context: .
          target: backend
          push: true
          tags: yourdockerhub/tronrelic-backend:latest
          cache-from: type=registry,ref=yourdockerhub/tronrelic-backend:buildcache
          cache-to: type=registry,ref=yourdockerhub/tronrelic-backend:buildcache,mode=max

      - name: Build and push frontend
        uses: docker/build-push-action@v4
        with:
          context: .
          target: frontend-prod
          push: true
          tags: yourdockerhub/tronrelic-frontend:latest
          cache-from: type=registry,ref=yourdockerhub/tronrelic-frontend:buildcache
          cache-to: type=registry,ref=yourdockerhub/tronrelic-frontend:buildcache,mode=max
```

## Additional Resources

- [Docker Documentation](https://docs.docker.com/)
- [Docker Compose Documentation](https://docs.docker.com/compose/)
- [Kubernetes Documentation](https://kubernetes.io/docs/)
- [Next.js Docker Deployment](https://nextjs.org/docs/deployment#docker-image)
- [Node.js Docker Best Practices](https://github.com/nodejs/docker-node/blob/main/docs/BestPractices.md)

## Support

For issues or questions:
- Review logs: `npm run docker:logs`
- Check health: `docker compose ps`
- Visit system monitor: http://localhost:3000/system
- Report issues: [GitHub Issues](https://github.com/yourusername/tronrelic/issues)
