# TronRelic Multi-Stage Docker Build
# Single-package architecture with backend and frontend images

# ============================================
# Stage 1: Install Dependencies and Build
# ============================================
FROM node:20-alpine AS builder
WORKDIR /app

# Install necessary build tools
RUN apk add --no-cache libc6-compat

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (needed for building)
RUN npm ci

# Copy all source code
COPY . .

# Build backend
RUN npm run build:backend

# Accept SITE_BACKEND as build argument for Next.js rewrites
ARG SITE_BACKEND=http://backend:4000
ENV SITE_BACKEND=${SITE_BACKEND}

# Build frontend with plugin registry generation
RUN npm run build:frontend

# ============================================
# Stage 2: Backend Production Image
# ============================================
# Use Debian-slim instead of Alpine for Playwright browser support
FROM node:20-slim AS backend
WORKDIR /app

# Install system dependencies for Playwright browsers (from npx playwright install-deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libatspi2.0-0 \
    libcairo2 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libglib2.0-0 \
    libnspr4 \
    libnss3 \
    libpango-1.0-0 \
    libx11-6 \
    libxcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxext6 \
    libxfixes3 \
    libxkbcommon0 \
    libxrandr2 \
    fonts-liberation \
    && rm -rf /var/lib/apt/lists/*

# Copy package files
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Install Playwright browsers (required for market fetchers using Playwright)
RUN npx playwright install chromium

# Copy built backend from builder
COPY --from=builder /app/dist/backend ./dist/backend

# Copy source files needed at runtime (types, plugins for runtime discovery)
COPY --from=builder /app/packages/types ./packages/types
COPY --from=builder /app/src/shared ./src/shared
COPY --from=builder /app/src/plugins ./src/plugins

# Copy compiled migration .js files to src/ paths for runtime discovery.
# MigrationScanner uses readdir() + dynamic import() at runtime, so individual
# files must exist on disk at the paths the scanner expects (src/backend/...).
# The build script compiles .ts migrations to .js under dist/, and we copy them
# here to match the scanner's src/backend/ base path.
COPY --from=builder /app/dist/backend/services/database/migrations ./src/backend/services/database/migrations
COPY --from=builder /app/dist/backend/modules ./src/backend/modules

# Expose backend port
EXPOSE 4000

# Set production environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Start backend server
CMD ["node", "dist/backend/index.js"]

# ============================================
# Stage 3: Frontend Development Image
# ============================================
FROM node:20-alpine AS frontend-dev
WORKDIR /app

# Install necessary build tools
RUN apk add --no-cache libc6-compat

# Copy package files
COPY package.json package-lock.json ./

# Install all dependencies (dev mode needs devDependencies)
RUN npm ci

# Copy source
COPY . .

# Generate plugin registry
RUN npm run generate:plugins

# Expose frontend dev port
EXPOSE 3000

# Set development environment
ENV NODE_ENV=development

# Start Next.js in dev mode with Turbopack
CMD ["npm", "run", "dev:frontend"]

# ============================================
# Stage 4: Frontend Production Image
# ============================================
FROM node:20-alpine AS frontend-prod
WORKDIR /app

# Install necessary build tools
RUN apk add --no-cache libc6-compat

# Copy package files
COPY --from=builder /app/package*.json ./

# Install production dependencies only
RUN npm ci --only=production

# Copy built Next.js standalone output from builder
COPY --from=builder /app/src/frontend/.next/standalone ./
COPY --from=builder /app/src/frontend/.next/static ./src/frontend/.next/static
COPY --from=builder /app/src/frontend/public ./src/frontend/public

# Remove "type": "module" from package.json for CommonJS standalone server
# Next.js standalone generates CommonJS; project source remains ESM
RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json')); delete p.type; fs.writeFileSync('package.json', JSON.stringify(p,null,2));"

# Expose frontend port
EXPOSE 3000

# Set production environment
ENV NODE_ENV=production

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

# Start Next.js production server
CMD ["node", "src/frontend/server.js"]
