# TronRelic Multi-Stage Docker Build
#
# Stages:
#   deps          Install root + per-plugin dependencies (needs GH Packages auth).
#   registry      Build plugins and generate plugin registries (prerequisite for typecheck/test).
#   test          Run typecheck + unit tests for core and plugins. Build target for CI validation.
#   builder       Compile backend and frontend artifacts.
#   backend       Production backend runtime image.
#   frontend-dev  Development frontend image (npm run dev).
#   frontend-prod Production frontend runtime image.
#
# GH Packages auth is provided via BuildKit secret:
#   docker build --secret id=npmrc,src=/path/to/.npmrc ...

# ============================================
# Stage 1: Install Dependencies
# ============================================
FROM node:20-alpine AS deps
WORKDIR /app

RUN apk add --no-cache libc6-compat

# Plugin dirs are copied before root npm ci because root workspaces include
# src/plugins/*/packages/*; missing workspace directories can break install.
COPY package.json package-lock.json ./
COPY packages ./packages
COPY src/plugins ./src/plugins

RUN --mount=type=secret,id=npmrc,target=/root/.npmrc npm ci

# Plugins are NOT root workspaces; each has its own package.json and deps
# (notably private @delphian/* types packages pulled from GitHub Packages).
RUN --mount=type=secret,id=npmrc,target=/root/.npmrc \
    for dir in src/plugins/*/; do \
      [ -f "${dir}package.json" ] || continue; \
      if [ -f "${dir}package-lock.json" ]; then \
        (cd "$dir" && npm ci --no-audit --no-fund) || exit 1; \
      else \
        (cd "$dir" && npm install --no-audit --no-fund) || exit 1; \
      fi; \
    done

# ============================================
# Stage 2: Build Plugins + Generate Registries
# ============================================
FROM deps AS registry
WORKDIR /app

COPY . .

RUN npm run build:plugins
RUN npm run generate:plugins

# ============================================
# Stage 3: Test (CI validation target)
# ============================================
# Build with: docker build --target test .
# No artifact shipped from this stage; failure halts CI before building prod images.
FROM registry AS test
WORKDIR /app

RUN npm run typecheck
RUN npm test
RUN npm run typecheck:plugins
RUN npm run test:plugins

# ============================================
# Stage 4: Build Backend + Frontend Artifacts
# ============================================
FROM registry AS builder
WORKDIR /app

RUN npm run build:backend

ARG SITE_BACKEND=http://backend:4000
ENV SITE_BACKEND=${SITE_BACKEND}

RUN npm run build:frontend

# ============================================
# Stage 5: Backend Production Image
# ============================================
# Debian-slim for Playwright browser support
FROM node:20-slim AS backend
WORKDIR /app

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

# Copy package files and prebuilt workspace outputs so npm ci can create
# @delphian/* symlinks without rebuilding. Strip prepare script so tsc
# (devDependency) does not run during production install.
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder /app/packages/types/dist ./packages/types/dist
RUN node -e "const f='packages/types/package.json';const p=require('./'+f);if(p.scripts){delete p.scripts.prepare;delete p.scripts.prepublishOnly;}require('fs').writeFileSync(f, JSON.stringify(p,null,4)+'\n');"

RUN npm ci --only=production

RUN npx playwright install chromium

COPY --from=builder /app/dist/backend ./dist/backend

# Plugin directories carry their installed node_modules from the builder stage,
# which is how plugin runtime imports (e.g. @delphian/trp-ai-assistant-types)
# resolve in production.
COPY --from=builder /app/src/shared ./src/shared
COPY --from=builder /app/src/plugins ./src/plugins

# Strip dev dependencies from each plugin's node_modules to reduce image size.
# npm prune is local (no network/auth), so no BuildKit secret needed here.
RUN for dir in src/plugins/*/; do \
      [ -f "${dir}package.json" ] || continue; \
      [ -d "${dir}node_modules" ] || continue; \
      (cd "$dir" && npm prune --omit=dev) || exit 1; \
    done

# MigrationScanner walks src/backend/... at runtime; mirror compiled .js files
# from dist/ to the paths the scanner expects.
COPY --from=builder /app/dist/backend/services/database/migrations ./src/backend/services/database/migrations
COPY --from=builder /app/dist/backend/modules ./src/backend/modules

EXPOSE 4000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:4000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

CMD ["node", "dist/backend/index.js"]

# ============================================
# Stage 6: Frontend Development Image
# ============================================
FROM deps AS frontend-dev
WORKDIR /app

COPY . .

RUN npm run build:plugins
RUN npm run generate:plugins

EXPOSE 3000
ENV NODE_ENV=development

CMD ["npm", "run", "dev:frontend"]

# ============================================
# Stage 7: Frontend Production Image
# ============================================
FROM node:20-alpine AS frontend-prod
WORKDIR /app

RUN apk add --no-cache libc6-compat

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/packages/types/package.json ./packages/types/package.json
COPY --from=builder /app/packages/types/dist ./packages/types/dist
RUN node -e "const f='packages/types/package.json';const p=require('./'+f);if(p.scripts){delete p.scripts.prepare;delete p.scripts.prepublishOnly;}require('fs').writeFileSync(f, JSON.stringify(p,null,4)+'\n');"

RUN npm ci --only=production

COPY --from=builder /app/src/frontend/.next/standalone ./
COPY --from=builder /app/src/frontend/.next/static ./src/frontend/.next/static
COPY --from=builder /app/src/frontend/public ./src/frontend/public

# Next.js standalone generates CommonJS; strip type:module from root package.json
# for the standalone server. Project source remains ESM.
RUN node -e "const fs=require('fs'); const p=JSON.parse(fs.readFileSync('package.json')); delete p.type; fs.writeFileSync('package.json', JSON.stringify(p,null,2));"

EXPOSE 3000
ENV NODE_ENV=production

HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
    CMD node -e "require('http').get('http://localhost:3000/api/health', (r) => { process.exit(r.statusCode === 200 ? 0 : 1); });"

CMD ["node", "src/frontend/server.js"]
