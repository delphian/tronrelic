# Pages Module

The pages module enables administrators to create custom user-facing content (articles, blog posts, static pages) with markdown authoring, file uploads, and dynamic routing. Pages are discoverable at URLs matching their configured slugs, rendered from markdown to HTML, and cached for performance.

## Who This Document Is For

Backend developers implementing content management features, frontend developers integrating custom pages, and maintainers understanding the storage provider architecture.

## Why This Module Exists

TronRelic's plugin system provides powerful blockchain-specific functionality, but administrators often need simpler content pages for documentation, announcements, or static marketing content. Without a dedicated pages system:

- **Content scattered across codebases** - Static pages require code changes, pull requests, and deployments
- **No admin control** - Content creators depend on developers for every text update
- **Rigid routing** - Adding new pages requires modifying Next.js routing configuration
- **No file management** - Images and attachments need manual deployment or external hosting
- **Performance overhead** - Rendering markdown on every request wastes CPU and slows page loads

The pages module solves these problems by providing a self-service content management system with:

- **Database-backed storage** - All pages, files, and settings persist in MongoDB
- **Frontmatter metadata** - SEO fields (title, description, keywords, Open Graph images) extracted from YAML blocks
- **Pluggable storage providers** - File uploads work with local filesystem, S3, or Cloudflare R2 without code changes
- **Redis-cached HTML** - Rendered markdown caches for 24 hours, reducing CPU load
- **Route conflict prevention** - Blacklist patterns prevent pages from overriding `/api` or `/system` routes
- **Dynamic slug routing** - Pages appear at their configured URLs without frontend configuration changes

## Architecture Overview

The module follows TronRelic's layered architecture pattern that separates infrastructure concerns (storage providers) from business logic (services):

```
pages/
├── api/                     # HTTP interface (Express routes and controller)
├── database/                # MongoDB schemas and models
├── services/                # Business logic layer
│   ├── page.service.ts      # Page/file/settings CRUD orchestration
│   ├── markdown.service.ts  # Frontmatter parsing and HTML rendering
│   └── storage/             # Infrastructure layer (providers)
│       ├── StorageProvider.ts      # Abstract provider interface
│       └── LocalStorageProvider.ts # Local filesystem implementation
└── index.ts                 # Public API and module initialization
```

### Why "Provider" Instead of "Service"?

The storage layer uses "Provider" terminology to distinguish infrastructure abstractions from business logic services:

**Providers signal:**
- **Pluggability** - Multiple implementations (LocalStorageProvider, S3StorageProvider, CloudflareProvider) can coexist
- **Clear abstraction boundary** - Infrastructure (file storage) vs business logic (page management)
- **Dependency injection friendly** - Concrete providers injected into PageService via constructor
- **Follows established patterns** - Common in auth providers, context providers, and DI containers

**Services handle:**
- **Business logic** - Page CRUD, slug validation, frontmatter parsing, cache invalidation
- **Orchestration** - Coordinate between database, storage providers, and cache
- **Domain rules** - Enforce blacklist patterns, file size limits, publish status checks

**Example from the codebase:**
```typescript
// index.ts - Provider injection into service
const storageProvider = new LocalStorageProvider();
const pageService = new PageService(database, storageProvider, cacheService, logger);
```

This pattern enables configuration-based provider switching without changing PageService code. Future S3 or Cloudflare providers can be swapped at module initialization without modifying business logic.

## Core Components

### PageService (Business Logic)

PageService implements `IPageService` and orchestrates all page, file, and settings operations. It depends on abstract interfaces (`IStorageProvider`, `IDatabaseService`, `ICacheService`) to avoid coupling to concrete implementations.

**Key responsibilities:**
- **Page CRUD** - Create, read, update, delete operations with frontmatter parsing
- **Slug management** - Sanitize URLs, validate against blacklist patterns, prevent duplicates
- **File uploads** - Validate extensions/sizes, sanitize filenames, coordinate storage provider
- **Markdown rendering** - Parse frontmatter, render body to HTML, cache in Redis
- **Settings management** - Load defaults, merge updates, persist configuration

**Dependency injection pattern:**
```typescript
constructor(
    database: IDatabaseService,          // MongoDB collections
    storageProvider: IStorageProvider,   // File storage (local, S3, etc.)
    cacheService: ICacheService,         // Redis cache for HTML
    logger: ISystemLogService            // Error tracking
)
```

### IStorageProvider Interface (Infrastructure Abstraction)

StorageProvider is an abstract base class that defines the contract for file storage implementations. All concrete providers extend this class and implement three methods:

```typescript
abstract class StorageProvider implements IStorageProvider {
    abstract upload(file: Buffer, filename: string, mimeType: string): Promise<string>;
    abstract delete(path: string): Promise<void>;
    abstract getUrl(path: string): string;
}
```

**Why abstract methods?**
- `upload()` - Different backends have distinct upload mechanisms (filesystem writes, S3 multipart, R2 API)
- `delete()` - Deletion varies by provider (unlink files, delete S3 objects, purge CDN cache)
- `getUrl()` - URLs differ by provider (relative paths for local, absolute URLs for CDN)

### LocalStorageProvider (Concrete Implementation)

LocalStorageProvider stores files in `/public/uploads/` organized by date (YY/MM structure). Files are served via Express static middleware at `/uploads/*` routes.

**Directory structure example:**
```
public/uploads/
├── 25/
│   ├── 01/
│   │   ├── announcement.png
│   │   └── hero-image.jpg
│   └── 10/
│       └── product-screenshot.webp
```

**Key implementation details:**
- Files organized by year/month to avoid directory bloat
- Returns relative paths (`/uploads/25/10/image.png`) for database storage
- Uses Node.js `fs/promises` API for async operations
- Creates date-based directories recursively if they don't exist

**Adding new providers:**

To add S3 or Cloudflare R2 support, create new provider classes:

```typescript
// S3StorageProvider.ts
import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import { StorageProvider } from './StorageProvider.js';

export class S3StorageProvider extends StorageProvider {
    constructor(
        private readonly s3Client: S3Client,
        private readonly bucket: string,
        private readonly cdnUrl: string
    ) {
        super();
    }

    async upload(file: Buffer, filename: string, mimeType: string): Promise<string> {
        const key = `uploads/${filename}`;
        await this.s3Client.send(new PutObjectCommand({
            Bucket: this.bucket,
            Key: key,
            Body: file,
            ContentType: mimeType,
        }));
        return key;
    }

    async delete(path: string): Promise<void> {
        await this.s3Client.send(new DeleteObjectCommand({
            Bucket: this.bucket,
            Key: path,
        }));
    }

    getUrl(path: string): string {
        return `${this.cdnUrl}/${path}`;
    }
}
```

Then inject at module initialization:

```typescript
// index.ts - Conditional provider selection
const storageProvider = env.STORAGE_PROVIDER === 's3'
    ? new S3StorageProvider(s3Client, bucket, cdnUrl)
    : new LocalStorageProvider();
```

### MarkdownService (Rendering and Caching)

MarkdownService handles markdown parsing, frontmatter extraction, HTML rendering, and Redis caching. It implements `IMarkdownService` for testability.

**Rendering pipeline:**
1. Parse frontmatter using `gray-matter` (YAML metadata extraction)
2. Convert markdown body to HTML using `remark` (GitHub Flavored Markdown support)
3. Sanitize HTML using `rehype-sanitize` (prevent XSS attacks)
4. Cache rendered HTML in Redis with 24-hour TTL
5. Return sanitized HTML string

**Frontmatter example:**
```markdown
---
title: "Getting Started with TronRelic"
slug: "/docs/getting-started"
description: "Learn how to deploy and configure TronRelic"
keywords: ["tron", "blockchain", "monitoring"]
published: true
ogImage: "/uploads/25/01/hero.png"
---

# Getting Started

Your markdown content here...
```

**Cache invalidation:**
- Automatic on page updates (slug changes invalidate old and new keys)
- Automatic on page deletion
- Manual via `invalidateCache(slug)` method

### PagesController (HTTP Interface)

PagesController exposes REST API endpoints for all CRUD operations. All admin endpoints require `x-admin-token` authentication header. Public endpoints filter to published pages only.

**Admin endpoints (require auth):**
- `GET /api/admin/pages` - List pages with filtering
- `POST /api/admin/pages` - Create page from markdown
- `PATCH /api/admin/pages/:id` - Update page content
- `DELETE /api/admin/pages/:id` - Delete page
- `GET /api/admin/pages/files` - List uploaded files
- `POST /api/admin/pages/files` - Upload file (multipart/form-data)
- `DELETE /api/admin/pages/files/:id` - Delete file
- `GET /api/admin/pages/settings` - Get configuration
- `PATCH /api/admin/pages/settings` - Update configuration

**Public endpoints (no auth):**
- `GET /api/pages/:slug` - Get published page by slug
- `GET /api/pages/:slug/render` - Get rendered HTML with metadata

## Database Schema

The module stores data in three MongoDB collections:

### pages Collection

Stores page documents with frontmatter metadata:

```typescript
interface IPageDocument {
    _id: ObjectId;
    title: string;
    slug: string;                    // URL path (e.g., "/docs/getting-started")
    content: string;                 // Full markdown including frontmatter
    description: string;             // SEO meta description
    keywords: string[];              // SEO keywords
    published: boolean;              // Only published pages are publicly accessible
    ogImage: string | null;          // Open Graph image URL
    authorId: string | null;         // Always null (admin-created)
    createdAt: Date;
    updatedAt: Date;
}
```

**Indexes:**
- `slug` (unique) - Fast lookup by URL
- `published` - Filter published vs draft pages
- Text index on `title`, `slug`, `description` for search

### page_files Collection

Tracks uploaded files with metadata:

```typescript
interface IPageFileDocument {
    _id: ObjectId;
    originalName: string;            // Original filename from user
    storedName: string;              // Sanitized filename on disk/storage
    mimeType: string;                // Content-Type for serving
    size: number;                    // Bytes
    path: string;                    // Storage provider path
    uploadedBy: string | null;       // Always null (admin uploads)
    uploadedAt: Date;
}
```

**Indexes:**
- `mimeType` - Filter by type (images, PDFs, etc.)
- `uploadedAt` - Sort by recency

### page_settings Collection

Stores module configuration (singleton document):

```typescript
interface IPageSettingsDocument {
    _id: ObjectId;
    blacklistedRoutes: string[];     // Regex patterns for slug validation
    maxFileSize: number;             // Bytes (default: 10 MB)
    allowedFileExtensions: string[]; // Whitelist (e.g., ['.png', '.jpg'])
    filenameSanitizationPattern: string; // Regex for filename cleaning
    storageProvider: 'local' | 's3' | 'cloudflare';
    updatedAt: Date;
}
```

**Default configuration:**
```typescript
{
    blacklistedRoutes: [
        '^/api/.*',      // Prevent overriding API routes
        '^/system/.*',   // Prevent overriding admin UI
        '^/admin/.*',    // Prevent overriding admin routes
        '^/_next/.*',    // Prevent overriding Next.js internals
        '^/markets$',    // Prevent overriding feature pages
        '^/accounts$',
        '^/transactions$',
        '^/whales$',
    ],
    maxFileSize: 10 * 1024 * 1024, // 10 MB
    allowedFileExtensions: ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.pdf'],
    filenameSanitizationPattern: '[^a-z0-9-_.]',
    storageProvider: 'local',
}
```

## Module Initialization

The pages module implements the `IModule` interface with two-phase initialization:

**Phase 1: init()** - Prepare module without starting
**Phase 2: run()** - Activate and integrate with application

```typescript
// PagesModule implements IModule<IPagesModuleDependencies>
class PagesModule implements IModule {
    readonly metadata = {
        id: 'pages',
        name: 'Pages',
        version: '1.0.0',
        description: 'Custom page creation and markdown rendering'
    };

    async init(dependencies: IPagesModuleDependencies): Promise<void> {
        // Store dependencies
        this.database = dependencies.database;
        this.app = dependencies.app;
        // Create services
        this.pageService = new PageService(...);
    }

    async run(): Promise<void> {
        // Register menu item (MenuService is guaranteed ready)
        await this.menuService.create({ ... });

        // Mount routers (IoC - module attaches itself)
        this.app.use('/api/admin/pages', this.createAdminRouter());
        this.app.use('/api/pages', this.createPublicRouter());
    }
}
```

**Integration in backend bootstrap:**
```typescript
// apps/backend/src/index.ts
import { PagesModule } from './modules/pages/index.js';

// Instantiate module
const pagesModule = new PagesModule();

// Phase 1: Initialize (create services, prepare resources)
await pagesModule.init({
    database: coreDatabase,
    cacheService: cacheService,
    menuService: MenuService.getInstance(),
    app: app  // Module mounts its own routes via IoC
});

// Phase 2: Run (mount routes, register menu items)
await pagesModule.run();
```

**Key architectural patterns:**

1. **Two-phase lifecycle**: `init()` prepares, `run()` activates
2. **Inversion of Control**: Module mounts its own routes using injected `app`
3. **Dependency injection**: All services injected as typed dependencies object
4. **No return values**: Module uses IoC to attach itself (no routers returned)
5. **Metadata**: Module exposes `id`, `name`, `version` for introspection

**Menu registration:**
The module creates a navigation entry in the `system` namespace at `/system/pages` during the `run()` phase. By this point, MenuService is guaranteed to be initialized (no need for 'ready' event subscriptions). The menu item persists only in memory (disappears on backend restart) following the plugin pattern.

## Public API Exports

The module exposes only necessary types and classes via `index.ts`:

```typescript
// Primary module export (implements IModule)
export { PagesModule } from './PagesModule.js';
export type { IPagesModuleDependencies } from './PagesModule.js';

// Services (for external consumers if needed)
export { PageService } from './services/page.service.js';
export { MarkdownService } from './services/markdown.service.js';

// Storage providers (for external consumers or custom configurations)
export { StorageProvider } from './services/storage/StorageProvider.js';
export { LocalStorageProvider } from './services/storage/LocalStorageProvider.js';

// HTTP layer (for testing or custom router configurations)
export { PagesController } from './api/pages.controller.js';
export { createPagesRouter } from './api/pages.routes.js';
export { createPublicPagesRouter } from './api/pages.public-routes.js';

// Database types (for external consumers working with page data)
export type { IPageDocument, IPageFileDocument, IPageSettingsDocument } from './database/index.js';
export { DEFAULT_PAGE_SETTINGS } from './database/index.js';
```

**Import pattern for consuming code:**
```typescript
// Good - uses public API for module initialization
import { PagesModule } from './modules/pages/index.js';
const pagesModule = new PagesModule();

// Good - uses public API for services
import { PageService, LocalStorageProvider } from './modules/pages/index.js';

// Bad - bypasses public API
import { PageService } from './modules/pages/services/page.service.js';
```

## Usage Examples

### Creating a Page (Admin)

**HTTP API:**
```bash
curl -X POST http://localhost:4000/api/admin/pages \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "---\ntitle: \"Announcement\"\nslug: \"/blog/announcement\"\npublished: true\n---\n# Hello World\n\nThis is a test page."
  }'
```

**Programmatic:**
```typescript
const pageService = new PageService(database, storageProvider, cacheService, logger);

const page = await pageService.createPage(`
---
title: "API Documentation"
slug: "/docs/api"
description: "Complete API reference for TronRelic"
keywords: ["api", "rest", "documentation"]
published: true
ogImage: "/uploads/25/01/api-header.png"
---

# API Documentation

Complete reference for TronRelic's REST API...
`);

console.log(`Created page: ${page.title} at ${page.slug}`);
```

### Uploading a File (Admin)

**HTTP API:**
```bash
curl -X POST http://localhost:4000/api/admin/pages/files \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -F "file=@/path/to/image.png"
```

**Programmatic:**
```typescript
const fileBuffer = await fs.readFile('/path/to/image.png');
const pageFile = await pageService.uploadFile(
    fileBuffer,
    'hero-image.png',
    'image/png'
);

console.log(`Uploaded: ${pageFile.path}`);
// Outputs: "Uploaded: /uploads/25/10/hero-image.png"
```

### Rendering a Page (Public)

**HTTP API:**
```bash
curl http://localhost:4000/api/pages/docs/api/render
```

**Response:**
```json
{
    "html": "<h1>API Documentation</h1>\n<p>Complete reference...</p>",
    "metadata": {
        "title": "API Documentation",
        "description": "Complete API reference for TronRelic",
        "keywords": ["api", "rest", "documentation"],
        "ogImage": "/uploads/25/01/api-header.png"
    }
}
```

**Programmatic:**
```typescript
const page = await pageService.getPageBySlug('/docs/api');
if (page && page.published) {
    const html = await pageService.renderPageHtml(page);
    // HTML is cached in Redis for 24 hours
}
```

### Updating Settings (Admin)

**HTTP API:**
```bash
curl -X PATCH http://localhost:4000/api/admin/pages/settings \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "maxFileSize": 20971520,
    "allowedFileExtensions": [".png", ".jpg", ".webp", ".pdf", ".mp4"]
  }'
```

**Programmatic:**
```typescript
const updatedSettings = await pageService.updateSettings({
    maxFileSize: 20 * 1024 * 1024, // 20 MB
    allowedFileExtensions: ['.png', '.jpg', '.webp', '.pdf', '.mp4']
});

console.log(`Max file size: ${updatedSettings.maxFileSize} bytes`);
```

## Pre-Implementation Checklist

Before deploying new pages module features, verify:

- [ ] Uses dependency injection for database, storage provider, and cache (no direct imports of concrete implementations)
- [ ] PageService depends on `IStorageProvider` interface (not `LocalStorageProvider` class)
- [ ] Storage providers extend `StorageProvider` abstract base class
- [ ] Frontmatter includes required `title` field (validation enforced in createPage/updatePage)
- [ ] Slug sanitization removes special characters and ensures leading slash
- [ ] Blacklist patterns prevent pages from overriding `/api`, `/system`, `/admin` routes
- [ ] Rendered HTML is cached in Redis with automatic invalidation on updates
- [ ] File uploads validate size and extension against settings before storage
- [ ] Public endpoints filter to `published: true` pages (drafts return 404)
- [ ] Admin endpoints require `x-admin-token` authentication header
- [ ] JSDoc comments explain the "why" before showing the "how"

## Related Documentation

**TronRelic architecture patterns:**
- [Menu Module](../menu/menu.service.ts) - Similar module structure and database layer
- [System Log Service](../../services/system-log/system-log.service.ts) - Singleton pattern and dependency injection example
- [Frontend Architecture](../../../../docs/frontend/frontend-architecture.md) - Feature-based organization pattern

**Core framework documentation:**
- [Documentation Standards](../../../../docs/documentation-guidance.md) - Writing conventions for all TronRelic docs
- [Environment Variables](../../../../docs/environment.md) - Configuration reference
- [System Architecture](../../../../docs/system/system.md) - Backend module patterns and dependency injection
