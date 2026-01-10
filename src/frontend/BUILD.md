# Frontend Build System

## Overview

The TronRelic frontend is a **Next.js application** that uses a different build system than the traditional TypeScript backend.

## Why No `dist/` Folder?

### Backend (Node.js/TypeScript)
```bash
npm run build  # Runs: tsc -p tsconfig.json
# Output: dist/
# Runtime: node dist/index.js
```

### Frontend (Next.js)
```bash
npm run build  # Runs: next build
# Output: .next/
# Runtime: next start
```

## Build Output Comparison

| Aspect | Backend | Frontend |
|--------|---------|----------|
| **Build tool** | TypeScript compiler (`tsc`) | Next.js bundler |
| **Output folder** | `dist/` | `.next/` |
| **Source location** | `src/` | `app/`, `features/`, `components/` |
| **Type checking** | Part of build | Separate (`tsc --noEmit`) |
| **Dev mode** | `tsx watch src/index.ts` | `next dev --turbo` |
| **Prod mode** | `node dist/index.js` | `next start` |

## TypeScript Configuration

### Frontend tsconfig.json
```json
{
  "compilerOptions": {
    "noEmit": true,        // ← TypeScript does NOT generate files
    "incremental": true,
    "jsx": "preserve",
    "module": "ESNext",
    // ...
  }
}
```

**Key point**: `"noEmit": true` means TypeScript is used **only for type checking**, not compilation.

### Build Process

1. **Type checking**: `tsc --noEmit` (finds errors, generates nothing)
2. **Bundling**: `next build` (handles TypeScript, React, optimization)
3. **Output**: `.next/` folder with optimized bundles

## Common Confusion

### ❌ Wrong Assumptions

1. "Frontend should have `dist/` like backend"
   - No, Next.js uses `.next/`

2. "Frontend should compile `.ts` → `.js` files"
   - No, `"noEmit": true` prevents this

3. "Frontend needs separate compilation step"
   - No, `next build` handles everything

### ✅ Correct Understanding

1. **Next.js is the build system**
   - Handles TypeScript compilation
   - Bundles for client and server
   - Optimizes images and assets
   - Manages code splitting

2. **TypeScript is for type safety only**
   - Runs during development (`next dev`)
   - Runs during build (`next build`)
   - Never generates `.js` files in source folders

3. **`.next/` is the build output**
   - Contains server bundles
   - Contains client bundles
   - Contains optimized assets
   - Should never be committed to git

## Stray Compiled Files Issue

### What Happened

Some `.js` and `.d.ts` files were accidentally committed to the frontend source folders:
- `apps/frontend/lib/*.js`
- `apps/frontend/lib/*.d.ts`
- `apps/frontend/store/**/*.js`
- `apps/frontend/store/**/*.d.ts`

### Why This Was Wrong

1. **Next.js doesn't generate these files** - It compiles to `.next/` only
2. **tsconfig has `"noEmit": true`** - TypeScript shouldn't generate them
3. **They were build artifacts** - Should never be committed

### Fixed

1. ✅ Updated `.gitignore` to ignore frontend compiled files
2. ✅ Removed all stray `.js` and `.d.ts` files from source
3. ✅ Configured proper ignore patterns

```gitignore
# Frontend compiled files (Next.js compiles to .next/, not source)
/apps/frontend/**/*.js
/apps/frontend/**/*.d.ts
!/apps/frontend/next.config.js
!/apps/frontend/next-env.d.ts
!/apps/frontend/.next/**/*
```

## Valid Files in Frontend Source

Only these JavaScript/TypeScript declaration files should exist:

- ✅ `next.config.js` - Next.js configuration
- ✅ `next-env.d.ts` - Next.js type definitions
- ✅ All `.ts` and `.tsx` files - Source code
- ❌ Any `.js` files (except config)
- ❌ Any `.d.ts` files (except Next.js generated)

## Development Workflow

### Start Development
```bash
npm run dev --workspace apps/frontend
# Runs: next dev --turbo
# Output: .next/ (dev build, auto-refreshes)
```

### Type Check
```bash
npm run typecheck --workspace apps/frontend
# Runs: tsc --noEmit
# Output: Console errors only, no files
```

### Build for Production
```bash
npm run build --workspace apps/frontend
# Runs: next build
# Output: .next/ (optimized production build)
```

### Start Production Server
```bash
npm run start --workspace apps/frontend
# Runs: next start
# Serves: .next/ folder
```

## Directory Structure

```
apps/frontend/
├── app/              # Next.js routes (source)
├── features/         # Feature modules (source)
├── components/       # Shared components (source)
├── lib/              # Utilities (source)
├── store/            # Redux store (source)
├── public/           # Static assets
├── .next/            # ✅ Build output (gitignored)
├── next.config.js    # ✅ Config (tracked)
├── next-env.d.ts     # ✅ Types (tracked)
├── tsconfig.json     # TypeScript config
└── package.json      # Dependencies & scripts
```

## Comparison: Backend vs Frontend

### Backend Build
```bash
# Backend compiles TypeScript to JavaScript
src/index.ts          → dist/index.js
src/api/routes.ts     → dist/api/routes.js
src/services/foo.ts   → dist/services/foo.js

# Runtime uses compiled JavaScript
node dist/index.js
```

### Frontend Build
```bash
# Frontend bundles everything to .next/
app/page.tsx          → .next/server/app/page.js (server bundle)
                      → .next/static/chunks/... (client bundle)
features/accounts/... → Included in bundles
components/ui/...     → Included in bundles

# Runtime uses Next.js server
next start  # Serves from .next/
```

## Key Takeaways

1. **No `dist/` folder for Next.js** - Uses `.next/` instead
2. **No compiled files in source** - Only `.next/` has output
3. **`"noEmit": true`** - TypeScript only checks types
4. **Next.js handles everything** - Compilation, bundling, optimization
5. **`.next/` is gitignored** - Never commit build output

This is standard for all Next.js applications and follows industry best practices! 🎯
