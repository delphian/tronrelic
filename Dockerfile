# TronRelic Multi-Stage Docker Build
# Separates backend and frontend into independent images with shared build stage

# ============================================
# Stage 1: Base Dependencies
# ============================================
FROM node:20-alpine AS base
WORKDIR /app

# Install necessary build tools
RUN apk add --no-cache libc6-compat

# Copy workspace configuration files
COPY package.json ./
COPY package-lock.json ./

# Copy all package.json files to establish workspace structure
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/plugins/ ./packages/plugins/
COPY apps/backend/package.json ./apps/backend/
COPY apps/frontend/package.json ./apps/frontend/

# ============================================
# Stage 2: Build Shared Packages + Plugins
# ============================================
FROM base AS builder-shared
WORKDIR /app

# Install ALL dependencies (needed for building)
RUN npm ci

# Copy base tsconfig (extended by other packages)
COPY tsconfig.base.json ./

# Copy tsconfig files for project references
COPY packages/types/tsconfig.json ./packages/types/
COPY packages/shared/tsconfig.json ./packages/shared/
# Plugin tsconfigs already copied with full plugins directory above

# Copy source code for shared packages and plugins
COPY packages/types ./packages/types
COPY packages/shared ./packages/shared
COPY packages/plugins ./packages/plugins

# Build shared packages in correct dependency order
# 1. Types (no dependencies)
RUN npm run build --workspace=@tronrelic/types

# 2. Shared (depends on types)
RUN npm run build --workspace=@tronrelic/shared

# 3. Plugin backends (depend on types and shared)
RUN npm run build:plugin-backends

# 4. Plugin frontends (source files, copied as-is for Next.js)
RUN npm run build:plugin-frontends

# ============================================
# Stage 3: Backend Production Image
# ============================================
# Use Debian-slim instead of Alpine for Playwright browser support
FROM node:20-slim AS backend
WORKDIR /app

# Install system dependencies for Playwright browsers
RUN apt-get update && apt-get install -y --no-install-recommends \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libpango-1.0-0 \
    libcairo2 \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY package.json ./
COPY package-lock.json ./
COPY packages/types/package.json ./packages/types/
COPY packages/shared/package.json ./packages/shared/
COPY packages/plugins/ ./packages/plugins/
COPY apps/backend/package.json ./apps/backend/

# Install ALL dependencies (needed for building)
RUN npm ci

# Install Playwright browsers (required for market fetchers using Playwright)
RUN npx playwright install chromium

# Copy built artifacts and source from shared builder stage
# Note: TypeScript project references with "composite": true need source files
COPY --from=builder-shared /app/packages/types ./packages/types
COPY --from=builder-shared /app/packages/shared ./packages/shared
COPY --from=builder-shared /app/packages/plugins ./packages/plugins

# Copy base tsconfig (extended by backend)
COPY tsconfig.base.json ./

# Copy backend source and tsconfig
COPY apps/backend/tsconfig.json ./apps/backend/
COPY apps/backend/src ./apps/backend/src

# Build backend application
RUN npm run build --workspace=apps/backend

# Remove dev dependencies to reduce image size (after build)
RUN npm prune --omit=dev

# Expose backend port
EXPOSE 4000

# Set production environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Start backend server
CMD ["node", "apps/backend/dist/index.js"]

# ============================================
# Stage 4: Frontend Development Image
# ============================================
FROM base AS frontend-dev
WORKDIR /app

# Install ALL dependencies (dev mode needs devDependencies)
RUN npm ci

# Copy base tsconfig (extended by frontend)
COPY tsconfig.base.json ./

# Copy built types from shared builder
COPY --from=builder-shared /app/packages/types/dist ./packages/types/dist
COPY --from=builder-shared /app/packages/types/package.json ./packages/types/

# Copy plugin source files (Next.js will compile them)
COPY --from=builder-shared /app/packages/plugins ./packages/plugins

# Copy frontend source
COPY apps/frontend ./apps/frontend

# Generate plugin registry
RUN npm run generate:plugins --workspace=apps/frontend

# Expose frontend dev port
EXPOSE 3000

# Set development environment
ENV NODE_ENV=development

# Start Next.js in dev mode with Turbopack
CMD ["npm", "run", "dev", "--workspace=apps/frontend"]

# ============================================
# Stage 5: Frontend Production Image
# ============================================
FROM base AS frontend-prod
WORKDIR /app

# Accept SITE_BACKEND as build argument for Next.js rewrites
ARG SITE_BACKEND=http://backend:4000

# Install ALL dependencies first (needed for build)
RUN npm ci

# Copy base tsconfig (extended by frontend)
COPY tsconfig.base.json ./

# Copy built types from shared builder
COPY --from=builder-shared /app/packages/types/dist ./packages/types/dist
COPY --from=builder-shared /app/packages/types/package.json ./packages/types/

# Copy plugin source files (Next.js will compile them)
COPY --from=builder-shared /app/packages/plugins ./packages/plugins

# Copy frontend source
COPY apps/frontend ./apps/frontend

# Generate plugin registry
RUN npm run generate:plugins --workspace=apps/frontend

# Build Next.js for production with SITE_BACKEND available
RUN SITE_BACKEND=$SITE_BACKEND npm run build --workspace=apps/frontend

# Remove dev dependencies to reduce image size
RUN npm prune --omit=dev

# Expose frontend port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Start Next.js production server
CMD ["npm", "run", "start", "--workspace=apps/frontend"]
