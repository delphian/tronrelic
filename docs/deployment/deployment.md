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

TronRelic uses a **dual-environment deployment strategy** with separate production and development servers:

```
Production (tronrelic.com)
├── Domain: tronrelic.com
├── Server: Digital Ocean Droplet
├── Deployment: /opt/tronrelic
├── Docker Images: ghcr.io/delphian/tronrelic/*:latest
└── CI/CD: Auto-deploy on push to 'main' branch

Development (dev.tronrelic.com)
├── Domain: dev.tronrelic.com
├── Server: Digital Ocean Droplet (165.232.161.21)
├── Deployment: /opt/tronrelic-dev
├── Docker Images: ghcr.io/delphian/tronrelic/*:dev
└── CI/CD: Auto-deploy on push to 'dev' branch
```

**Key architectural decisions:**
- **Docker-based deployment**: All services run as containers for consistency and portability
- **Nginx reverse proxy**: Routes traffic to backend (port 4000) and frontend (port 3000)
- **HTTPS with Let's Encrypt**: Production uses SSL certificates for secure communication
- **GitHub Container Registry**: Stores Docker images built by GitHub Actions
- **MongoDB and Redis**: Run as Docker containers with persistent volumes

## Detailed Documentation

This directory contains four focused documents covering different aspects of deployment:

**See [deployment-server-info.md](./deployment-server-info.md) for complete details on:**
- Production and development server locations
- IP addresses and domain configurations
- SSH authentication and access procedures
- Required credentials and secrets management
- GitHub Container Registry authentication

**See [deployment-workflows.md](./deployment-workflows.md) for complete details on:**
- Initial server setup from bare Ubuntu to running TronRelic
- Manual deployment updates using deployment scripts
- CI/CD automation with GitHub Actions
- SSL certificate setup with Let's Encrypt
- Environment-specific configuration (production vs development)

**See [deployment-remote-access.md](./deployment-remote-access.md) for complete details on:**
- SSH connection procedures and authentication
- Docker container management commands
- Log inspection and debugging techniques
- Database access (MongoDB and Redis)
- Service health checks and monitoring

## Quick Reference

### Server Information

| Environment | Domain | IP Address | Deploy Directory | Image Tag |
|-------------|--------|------------|------------------|-----------|
| **Production** | tronrelic.com | <PROD_DROPLET_IP> | /opt/tronrelic | :latest |
| **Development** | dev.tronrelic.com | 165.232.161.21 | /opt/tronrelic-dev | :dev |

### Common Commands

**Connect to servers:**
```bash
# Production
ssh root@<PROD_DROPLET_IP>

# Development
ssh root@165.232.161.21
```

**Deploy updates:**
```bash
# Production (manual)
./scripts/droplet-update.sh

# Development (manual)
./scripts/droplet-update-dev.sh
```

**View logs:**
```bash
# On remote server
cd /opt/tronrelic         # or /opt/tronrelic-dev
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
./scripts/droplet-stats.sh <DROPLET_IP>
```

**Access databases:**
```bash
# MongoDB
docker exec -it tronrelic-mongo-prod mongosh tronrelic

# Redis
docker exec -it tronrelic-redis-prod redis-cli
```

### Deployment Checklist

**Initial setup (new server):**
- [ ] Provision Digital Ocean droplet with Ubuntu 22.04+
- [ ] Configure SSH key authentication
- [ ] Point DNS A record to droplet IP
- [ ] Generate GitHub Personal Access Token (read:packages scope)
- [ ] Obtain three TronGrid API keys
- [ ] Run initial deployment script (droplet-deploy.sh or droplet-deploy-dev.sh)
- [ ] Save generated credentials securely
- [ ] (Production only) Run SSL setup script (droplet-setup-ssl.sh)
- [ ] Verify deployment health checks

**Update deployment:**
- [ ] Push changes to appropriate branch (main or dev)
- [ ] Wait for GitHub Actions to build and push images
- [ ] Run manual deployment script (optional, CI/CD auto-deploys)
- [ ] Verify containers restarted successfully
- [ ] Check application health via /api/health endpoint

**Troubleshooting:**
- [ ] Check container status: `docker compose ps`
- [ ] View logs: `docker compose logs -f backend frontend`
- [ ] Verify network connectivity: `curl http://localhost:4000/api/health`
- [ ] Check disk space: `df -h`
- [ ] Monitor resources: `./scripts/droplet-stats.sh`

## CI/CD Pipeline

TronRelic uses GitHub Actions for automated deployment:

**Production pipeline (.github/workflows/docker-publish.yml):**
1. Triggered on push to `main` branch
2. Runs integration tests with Docker Compose
3. Builds backend and frontend images
4. Tags images as `:latest` and `:$COMMIT_SHA`
5. Pushes images to GitHub Container Registry
6. Manual deployment required (run `./scripts/droplet-update.sh`)

**Development pipeline (.github/workflows/docker-publish-dev.yml):**
1. Triggered on push to `dev` branch
2. Builds backend and frontend images
3. Tags images as `:dev` and `:dev-$COMMIT_SHA`
4. Pushes images to GitHub Container Registry
5. **Automatically deploys** to dev.tronrelic.com via SSH

## Security Considerations

**Required secrets (stored in .env on server):**
- `ADMIN_API_TOKEN` - Access to /system monitoring endpoint (generate with `openssl rand -hex 32`)
- `TRONGRID_API_KEY` (x3) - TronGrid API access keys
- `MONGO_ROOT_PASSWORD` - MongoDB authentication (production only)
- `REDIS_PASSWORD` - Redis authentication (production only)

**GitHub repository secrets (for CI/CD):**
- `ADMIN_API_TOKEN` - Testing only (not deployed to servers)
- `TRONGRID_API_KEY`, `TRONGRID_API_KEY_2`, `TRONGRID_API_KEY_3` - Testing only
- `DEV_DROPLET_HOST` - Development server IP
- `DEV_DROPLET_USER` - SSH user (root)
- `DEV_DROPLET_SSH_KEY` - SSH private key for authentication

**Best practices:**
- Never commit .env files or credentials to version control
- Rotate API tokens and passwords regularly
- Use SSH key authentication instead of passwords
- Enable firewall (UFW) to restrict access to necessary ports
- Use HTTPS/TLS for production deployments
- Regularly update base Docker images and system packages

## Further Reading

**Detailed documentation:**
- [deployment-server-info.md](./deployment-server-info.md) - Server locations, credentials, authentication
- [deployment-workflows.md](./deployment-workflows.md) - Setup and update procedures
- [deployment-remote-access.md](./deployment-remote-access.md) - SSH, debugging, remote management

**Related topics:**
- [docker-deployment.md](../docker-deployment.md) - Docker architecture and local development
- [environment.md](../environment.md) - Environment variable configuration
- [api-catalog.md](../api-catalog.md) - API endpoints and health checks
