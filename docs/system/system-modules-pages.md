# Pages Module

The pages module provides custom content management capabilities, allowing administrators to create user-facing pages (articles, documentation, announcements) with markdown authoring, file uploads, and dynamic routing. Pages are rendered from markdown to HTML, cached for performance, and discoverable at URLs matching their configured slugs.

## Who This Document Is For

Backend developers implementing content management features, frontend developers integrating custom pages into the UI, and maintainers understanding the storage provider abstraction layer.

## Why This Matters

TronRelic's plugin system excels at blockchain-specific features, but administrators need simpler content pages for documentation, announcements, or marketing content. Without the pages module:

- **Content scattered across codebases** - Static pages require code changes, pull requests, and deployments for every update
- **No admin control** - Content creators depend on developers for every text change
- **Rigid routing** - Adding new pages requires modifying Next.js routing configuration
- **No file management** - Images and attachments need manual deployment or external hosting
- **Performance overhead** - Rendering markdown on every request wastes CPU cycles and slows page loads
- **SEO limitations** - No structured metadata management for search engines and social sharing

The pages module solves these problems by providing:

- **Database-backed storage** - Pages, files, and settings persist in MongoDB without code deployments
- **Frontmatter metadata** - SEO fields (title, description, keywords, Open Graph images) extracted from YAML blocks
- **Pluggable storage providers** - File uploads work with local filesystem, S3, or Cloudflare R2 without code changes
- **Redis-cached HTML** - Rendered markdown caches for 24 hours, reducing CPU load by avoiding repeated parsing
- **Route conflict prevention** - Blacklist patterns prevent pages from overriding `/api` or `/system` routes
- **Dynamic slug routing** - Pages appear at configured URLs without frontend configuration changes
- **Automatic redirect preservation** - Old URLs redirect to current locations when slugs change, preventing 404 errors and maintaining SEO value

## Architecture Overview

The module follows TronRelic's layered architecture pattern that separates infrastructure concerns (storage providers) from business logic (services). This enables swapping storage backends without touching business logic.

**Directory structure:**
```
modules/pages/
├── api/                     # HTTP interface (Express routes and controller)
│   ├── pages.controller.ts  # Request handlers for all endpoints
│   ├── pages.routes.ts      # Admin router factory
│   └── pages.public-routes.ts # Public router factory
├── database/                # MongoDB schemas and type definitions
│   ├── IPageDocument.ts     # Page model with frontmatter fields
│   ├── IPageFileDocument.ts # File upload tracking
│   ├── IPageSettingsDocument.ts # Configuration model
│   └── index.ts             # Barrel exports
├── services/                # Business logic layer
│   ├── page.service.ts      # Page/file/settings CRUD orchestration
│   ├── markdown.service.ts  # Frontmatter parsing and HTML rendering
│   └── storage/             # Infrastructure abstraction layer
│       ├── StorageProvider.ts      # Abstract provider interface
│       └── LocalStorageProvider.ts # Local filesystem implementation
├── __tests__/              # Unit and integration tests
├── PagesModule.ts          # IModule implementation
├── index.ts                # Public API exports
└── README.md               # Module-specific documentation
```

**Key architectural patterns:**

1. **Two-phase lifecycle** - `init()` prepares services, `run()` mounts routes and registers menu items
2. **Dependency injection** - All services receive typed dependencies via constructor or `setDependencies()`
3. **Inversion of Control** - Module mounts its own routes using injected `app` instead of returning routers
4. **Service-Provider separation** - Business logic (PageService) depends on infrastructure interfaces (IStorageProvider)
5. **Singleton pattern** - PageService implements `IPageService` interface and uses singleton pattern for shared state

### Why "Provider" Instead of "Service"?

The storage layer uses "Provider" terminology to signal infrastructure abstraction:

**Providers indicate:**
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
// PagesModule.init() - Provider injection into singleton service
const storageProvider = new LocalStorageProvider();

// Configure singleton once during bootstrap
PageService.setDependencies(database, storageProvider, cacheService, logger);

// All consumers use the same shared instance
const pageService = PageService.getInstance();
```

This pattern enables configuration-based provider switching without changing PageService code. Future S3 or Cloudflare providers can be swapped at module initialization.

## Core Components

### PageService (Business Logic)

PageService implements `IPageService` and orchestrates all page, file, and settings operations. **As a service with an `IXxxService` interface, it's a singleton providing a public API with shared single state.** All consumers (modules, plugins, controllers) use the same instance configured once during bootstrap.

**Key characteristics:**
- **Singleton pattern** - One instance shared across the application
- **Public API** - Consumers call methods like `createPage()`, `getPageBySlug()` directly
- **Bootstrap-only configuration** - Dependencies injected once via `setDependencies()`, then immutable
- **Shared state** - All consumers interact with the same MongoDB collections and cache

**Key responsibilities:**
- **Page CRUD** - Create, read, update, delete operations with frontmatter parsing
- **Slug management** - Sanitize URLs, validate against blacklist patterns, prevent duplicates, preserve redirect history
- **Redirect lookups** - Find pages by old slugs for 301 permanent redirects
- **Conflict prevention** - Validate slugs against current pages, old slugs, and circular references
- **File uploads** - Validate extensions/sizes, sanitize filenames, coordinate storage provider
- **Markdown rendering** - Parse frontmatter, render body to HTML, cache in Redis
- **Settings management** - Load defaults, merge updates, persist configuration

**Singleton dependency injection pattern:**
```typescript
// Private constructor - cannot instantiate directly
private constructor(
    database: IDatabaseService,          // MongoDB collections
    storageProvider: IStorageProvider,   // File storage (local, S3, etc.)
    cacheService: ICacheService,         // Redis cache for HTML
    logger: ISystemLogService            // Error tracking
)

// Configure once during bootstrap
static setDependencies(database, storageProvider, cacheService, logger): void

// All consumers use this shared instance
static getInstance(): PageService
```

**Common operations:**
```typescript
// Create page from markdown with frontmatter
const page = await pageService.createPage(markdownContent);

// Get published page by URL slug
const page = await pageService.getPageBySlug('/docs/api');

// Find page by old slug (for redirects)
const redirectPage = await pageService.findPageByOldSlug('/old-url');
if (redirectPage) {
    // Redirect to redirectPage.slug with 301 status
}

// Render cached HTML
const html = await pageService.renderPageHtml(page);

// Upload file with validation
const file = await pageService.uploadFile(buffer, filename, mimeType);

// Update configuration
const settings = await pageService.updateSettings({ maxFileSize: 20_000_000 });
```

### IStorageProvider Interface (Infrastructure Abstraction)

StorageProvider is an abstract base class defining the contract for file storage implementations. All concrete providers extend this class and implement three methods.

**Abstract methods:**
```typescript
abstract class StorageProvider implements IStorageProvider {
    /**
     * Upload file to storage backend.
     *
     * @param file - File buffer to upload
     * @param filename - Sanitized filename from validation
     * @param mimeType - Content-Type for serving
     * @returns Storage path for database tracking
     */
    abstract upload(file: Buffer, filename: string, mimeType: string): Promise<string>;

    /**
     * Delete file from storage backend.
     *
     * @param path - Storage path from database
     * @returns True if file existed and was deleted, false if already missing
     */
    abstract delete(path: string): Promise<boolean>;

    /**
     * Get public URL for accessing the file.
     *
     * @param path - Storage path from database
     * @returns URL for browser access (relative or absolute)
     */
    abstract getUrl(path: string): string;
}
```

**Why abstract methods?**
- `upload()` - Different backends have distinct upload mechanisms (filesystem writes, S3 multipart, R2 API)
- `delete()` - Deletion varies by provider (unlink files, delete S3 objects, purge CDN cache)
- `getUrl()` - URLs differ by provider (relative paths for local, absolute URLs for CDN)

### LocalStorageProvider (Default Implementation)

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
- Returns boolean from `delete()` indicating whether file existed

**Adding new providers:**

To add S3 or Cloudflare R2 support, create new provider classes:

```typescript
// services/storage/S3StorageProvider.ts
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

    async delete(path: string): Promise<boolean> {
        try {
            await this.s3Client.send(new DeleteObjectCommand({
                Bucket: this.bucket,
                Key: path,
            }));
            return true;
        } catch (error) {
            if (error.name === 'NoSuchKey') {
                return false;
            }
            throw error;
        }
    }

    getUrl(path: string): string {
        return `${this.cdnUrl}/${path}`;
    }
}
```

Then inject at module initialization:

```typescript
// PagesModule.ts - Conditional provider selection
const storageProvider = env.STORAGE_PROVIDER === 's3'
    ? new S3StorageProvider(s3Client, bucket, cdnUrl)
    : new LocalStorageProvider();

PageService.setDependencies(database, storageProvider, cacheService, logger);
```

### MarkdownService (Rendering and Caching)

MarkdownService handles markdown parsing, frontmatter extraction, HTML rendering, and Redis caching. It uses `gray-matter` for YAML parsing and `remark`/`rehype` for markdown-to-HTML conversion.

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
oldSlugs: ["/getting-started", "/docs/setup"]
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

**Cache key pattern:** `page:html:{slug}` (e.g., `page:html:/docs/getting-started`)

### PagesController (HTTP Interface)

PagesController exposes REST API endpoints for all CRUD operations. All admin endpoints require `x-admin-token` authentication header (enforced by `requireAdmin` middleware). Public endpoints filter to published pages only.

**Admin endpoints (require auth):**
- `GET /api/admin/pages` - List pages with filtering (published status, search, pagination)
- `GET /api/admin/pages/:id` - Get single page by ID
- `POST /api/admin/pages` - Create page from markdown with frontmatter
- `PATCH /api/admin/pages/:id` - Update page content and metadata
- `DELETE /api/admin/pages/:id` - Delete page and invalidate cache
- `POST /api/admin/pages/preview` - Preview markdown content without saving (live editor preview)
- `GET /api/admin/pages/files` - List uploaded files with filtering
- `POST /api/admin/pages/files` - Upload file (multipart/form-data with Multer)
- `DELETE /api/admin/pages/files/:id` - Delete file from storage and database
- `GET /api/admin/pages/settings` - Get configuration (blacklist, file size, extensions)
- `PATCH /api/admin/pages/settings` - Update configuration

**Public endpoints (no auth):**
- `GET /api/pages/:slug` - Get published page metadata by slug (returns page data with slug metadata for client-side redirect if slug is old)
- `GET /api/pages/:slug/render` - Get rendered HTML with SEO metadata (returns page data with slug metadata for client-side redirect if slug is old)

### Automatic Redirect System

The pages module preserves redirect history when page URLs change, preventing 404 errors and maintaining SEO value. When an admin updates a page's slug field, the old slug is automatically added to the `oldSlugs` array without requiring manual configuration.

**Redirect flow for visitors:**

When a user visits a URL that doesn't match any current page slug, the system checks all pages' `oldSlugs` arrays for a match. If found and the page is published, the backend returns page data with both the current slug and the requested slug in the response body. The frontend Next.js catch-all route detects the slug mismatch, compares `requestedSlug` with `page.slug`, and performs a client-side redirect using Next.js's `redirect()` function. This entire process happens during SSR before any HTML is sent to the browser, ensuring search engines see proper 301 redirects (triggered by the frontend's redirect() call) and transfer all SEO authority to the new URL.

**Example redirect scenario:**

An admin creates a page at `/about` and later changes the slug to `/company/about` in the frontmatter. The system automatically adds `/about` to the `oldSlugs` array when saving the update. Users visiting `/about` now receive page data where `requestedSlug` is `/about` and `page.slug` is `/company/about`. The frontend detects this mismatch and redirects to `/company/about`, and search engines update their indexes to use the new URL. If the admin later changes the slug again to `/company/team`, the `oldSlugs` array becomes `["/about", "/company/about"]`, preserving the complete redirect chain.

**Conflict prevention:**

The validation system prevents all forms of slug conflicts to ensure redirects work reliably. When creating a new page, the system checks that the new slug doesn't match any existing page's current slug or any page's oldSlugs array. When updating a page, the system validates that the new slug isn't in the page's own oldSlugs array (circular reference), doesn't conflict with other pages' current slugs or their oldSlugs arrays, and each oldSlug entry doesn't conflict with any other page's current slug. These comprehensive checks prevent scenarios where multiple pages claim the same URL or redirect loops occur.

**Performance characteristics:**

The oldSlugs index enables sub-millisecond redirect lookups even with thousands of pages. The redirect check only runs when a slug doesn't match any current page, so the performance impact on normal page loads is zero. The client-side redirect happens during SSR (before HTML is sent to the browser), ensuring search engines see proper 301 status codes and the redirect process is transparent to users.

**File upload validation:**

The controller uses a two-layer validation strategy for file uploads:

1. **Multer hard limit** - 100MB ceiling to prevent memory exhaustion
2. **Database-configured limit** - Runtime validation using `page_settings.maxFileSize`

This enables administrators to adjust the limit via settings API without restarting the backend. When validation fails, the controller returns a 413 Payload Too Large error with friendly JSON:

```json
{
    "error": "File too large",
    "message": "File size 15.23MB exceeds the maximum allowed size of 10.00MB",
    "fileSize": 15966208,
    "maxFileSize": 10485760
}
```

## Database Schema

The module stores data in three MongoDB collections:

### pages Collection

Stores page documents with frontmatter metadata.

**Schema:**
```typescript
interface IPageDocument {
    _id: ObjectId;
    title: string;                   // From frontmatter.title
    slug: string;                    // URL path (e.g., "/docs/getting-started")
    oldSlugs: string[];              // Previous slugs that redirect to current slug
    content: string;                 // Full markdown including frontmatter block
    description: string;             // SEO meta description from frontmatter
    keywords: string[];              // SEO keywords from frontmatter
    published: boolean;              // Visibility flag (only published pages public)
    ogImage: string | null;          // Open Graph image URL from frontmatter
    authorId: string | null;         // Always null (admin-created, future expansion)
    createdAt: Date;
    updatedAt: Date;
}
```

**Indexes:**
- `slug` (unique) - Fast lookup by URL, prevents duplicate slugs
- `oldSlugs` - Fast redirect lookups when current slug doesn't match
- `published` - Filter published vs draft pages efficiently
- Text index on `title`, `slug`, `description` - Full-text search support

**Validation rules:**
- Slug must start with `/` (enforced by sanitization)
- Slug cannot match blacklisted patterns (e.g., `^/api/.*`)
- Slug cannot conflict with another page's current slug (enforced at create/update)
- Slug cannot conflict with another page's oldSlugs array (prevents redirect conflicts)
- Each oldSlug cannot conflict with any other page's current slug
- Slug cannot appear in its own oldSlugs array (prevents circular redirects)
- Title is required (enforced in service layer)
- When slug changes, old slug automatically added to oldSlugs array (no duplicates)

### page_files Collection

Tracks uploaded files with metadata for storage provider coordination.

**Schema:**
```typescript
interface IPageFileDocument {
    _id: ObjectId;
    originalName: string;            // Original filename from user upload
    storedName: string;              // Sanitized filename after validation
    mimeType: string;                // Content-Type for serving files
    size: number;                    // File size in bytes
    path: string;                    // Storage provider path (relative or absolute)
    uploadedBy: string | null;       // Always null (admin uploads, future expansion)
    uploadedAt: Date;
}
```

**Indexes:**
- `mimeType` - Filter by type (images, PDFs, videos, etc.)
- `uploadedAt` - Sort by recency for file browser

**Filename sanitization:**
- Converts to lowercase
- Replaces spaces with hyphens
- Applies regex pattern from settings (default: removes all non-alphanumeric except `-_.)
- Preserves file extension
- Example: `"My Cool Photo.PNG"` → `"my-cool-photo.png"`

### page_settings Collection

Stores module configuration as a singleton document.

**Schema:**
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

**Settings initialization:**
- Created with defaults on first `getSettings()` call if collection is empty
- Updates merge with existing settings (partial updates supported)
- Validation enforced in service layer (e.g., maxFileSize >= 1)

## Module Lifecycle

The pages module implements the `IModule` interface with two-phase initialization:

**Phase 1: init()** - Prepare module without activation
- Store injected dependencies (database, cache, menu service, app)
- Ensure uploads directory exists (`/public/uploads/`)
- Create storage provider instance (default: LocalStorageProvider)
- Initialize PageService singleton with `setDependencies()`
- Create controller with service reference

**Phase 2: run()** - Activate and integrate with application
- Register menu item in `system` namespace at `/system/pages`
- Mount admin router at `/api/admin/pages` with `requireAdmin` middleware
- Mount public router at `/api/pages` (no authentication)

**Module metadata:**
```typescript
{
    id: 'pages',
    name: 'Pages',
    version: '1.0.0',
    description: 'Custom page creation and markdown rendering for admin-authored content'
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

**Key architectural patterns demonstrated:**

1. **Two-phase lifecycle** - `init()` prepares, `run()` activates (prevents race conditions)
2. **Inversion of Control** - Module mounts its own routes using injected `app` (no routers returned)
3. **Dependency injection** - All services injected as typed dependencies object
4. **Singleton pattern** - PageService uses `setDependencies()` + `getInstance()` pattern
5. **Menu registration** - Creates navigation entry in `system` namespace during `run()`
6. **Metadata** - Exposes `id`, `name`, `version` for introspection

**Menu registration details:**

The module creates a navigation entry in the `system` namespace (admin-only section) at `/system/pages` during the `run()` phase. By this point, MenuService is guaranteed to be initialized and ready (no need for 'ready' event subscriptions like plugins require). The menu item uses the default `persist: false` setting, creating a memory-only entry that disappears on backend restart (following the plugin pattern for runtime entries).

## REST API Reference

All admin endpoints require authentication via `x-admin-token` or `Authorization: Bearer` header. Public endpoints are accessible to all users but filter to published pages only.

### Admin Endpoints

**List Pages:**
```
GET /api/admin/pages?published=true&search=api&limit=50&skip=0

Response: {
    pages: IPage[],
    stats: { total: number, published: number, drafts: number }
}
```

**Get Page:**
```
GET /api/admin/pages/:id

Response: IPage
```

**Create Page:**
```
POST /api/admin/pages
Content-Type: application/json

{
    "content": "---\ntitle: \"My Page\"\nslug: \"/blog/post\"\npublished: true\n---\n# Content"
}

Response: IPage (201 Created)
```

**Update Page:**
```
PATCH /api/admin/pages/:id
Content-Type: application/json

{
    "content": "---\ntitle: \"Updated Title\"\n---\n# Updated content"
}

Response: IPage
```

**Delete Page:**
```
DELETE /api/admin/pages/:id

Response: 204 No Content
```

**Preview Markdown:**
```
POST /api/admin/pages/preview
Content-Type: application/json

{
    "content": "---\ntitle: \"My Page\"\nslug: \"/test\"\n---\n# Test Content"
}

Response: {
    html: string,
    metadata: {
        title: string,
        slug: string,
        oldSlugs: string[] | undefined,
        description: string | undefined,
        keywords: string[] | undefined,
        published: boolean,
        ogImage: string | undefined
    }
}
```

**List Files:**
```
GET /api/admin/pages/files?mimeType=image/&limit=100&skip=0

Response: { files: IPageFile[] }
```

**Upload File:**
```
POST /api/admin/pages/files
Content-Type: multipart/form-data

file: <binary data>

Response: IPageFile (201 Created)
```

**Delete File:**
```
DELETE /api/admin/pages/files/:id

Response: 204 No Content
```

**Get Settings:**
```
GET /api/admin/pages/settings

Response: IPageSettings
```

**Update Settings:**
```
PATCH /api/admin/pages/settings
Content-Type: application/json

{
    "maxFileSize": 20971520,
    "allowedFileExtensions": [".png", ".jpg", ".webp", ".pdf"]
}

Response: IPageSettings
```

### Public Endpoints

**Get Page Metadata:**
```
GET /api/pages/:slug

Response: { page: IPage, requestedSlug: string }

# If slug is in a page's oldSlugs array:
# Returns page data with current slug and requested slug for client-side redirect
Response: { page: IPage, requestedSlug: string }
# (Frontend compares page.slug with requestedSlug to trigger redirect)
```

**Render Page HTML:**
```
GET /api/pages/:slug/render

Response: {
    html: string,
    metadata: {
        title: string,
        description: string,
        keywords: string[],
        ogImage: string | undefined
    },
    requestedSlug: string
}

# If slug is in a page's oldSlugs array:
# Returns page data with current slug metadata for client-side redirect
Response: {
    html: string,
    metadata: { title, description, keywords, ogImage },
    requestedSlug: string
}
# (Frontend compares metadata slug with requestedSlug to trigger redirect)
```

## Usage Examples

### Creating a Page (Admin)

**HTTP API:**
```bash
curl -X POST http://localhost:4000/api/admin/pages \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "content": "---\ntitle: \"Getting Started\"\nslug: \"/docs/getting-started\"\ndescription: \"Learn TronRelic basics\"\nkeywords: [\"tutorial\", \"docs\"]\npublished: true\n---\n\n# Getting Started\n\nWelcome to TronRelic..."
  }'
```

**Programmatic:**
```typescript
const pageService = PageService.getInstance();

const page = await pageService.createPage(`
---
title: "API Documentation"
slug: "/docs/api"
oldSlugs: []
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
const pageService = PageService.getInstance();
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
const pageService = PageService.getInstance();
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
const pageService = PageService.getInstance();

const updatedSettings = await pageService.updateSettings({
    maxFileSize: 20 * 1024 * 1024, // 20 MB
    allowedFileExtensions: ['.png', '.jpg', '.webp', '.pdf', '.mp4']
});

console.log(`Max file size: ${updatedSettings.maxFileSize} bytes`);
```

## Pre-Implementation Checklist

Before deploying pages module features, verify:

- [ ] Module registered in backend bootstrap with two-phase initialization
- [ ] PageService singleton configured via `setDependencies()` before first use
- [ ] Storage provider injected as `IStorageProvider` interface (not concrete class)
- [ ] Frontmatter includes required `title` field (validation enforced in createPage/updatePage)
- [ ] Slug sanitization removes special characters and ensures leading slash
- [ ] Blacklist patterns prevent pages from overriding `/api`, `/system`, `/admin` routes
- [ ] Slug conflict validation prevents collisions with current slugs and oldSlugs arrays
- [ ] Circular reference validation prevents slugs from appearing in their own oldSlugs
- [ ] oldSlugs index exists in MongoDB for fast redirect lookups (migration `003_add_old_slugs_to_pages`)
- [ ] Backend returns page data with both `currentSlug` and `requestedSlug` for old slug lookups
- [ ] Frontend catch-all route compares slugs and triggers redirect with Next.js `redirect()` function
- [ ] Rendered HTML cached in Redis with automatic invalidation on updates
- [ ] File uploads validate size and extension against settings before storage
- [ ] Public endpoints filter to `published: true` pages (drafts return 404)
- [ ] Admin endpoints protected by `requireAdmin` middleware
- [ ] Uploads directory exists at `/public/uploads/` before Express static middleware starts
- [ ] Express static middleware configured to serve `/uploads/` directory
- [ ] Menu item registered in `system` namespace during `run()` phase
- [ ] JSDoc comments explain the "why" before showing the "how"

## Troubleshooting

### Page Appears in Database but Not Accessible

**Diagnosis:**
```bash
curl http://localhost:4000/api/pages/my-slug
# Returns 404
```

**Common causes:**
- Page is unpublished (`published: false`)
- Slug doesn't match exactly (missing leading slash)
- Slug is blacklisted by settings patterns

**Resolution:**
```typescript
const page = await pageService.getPageBySlug('/my-slug');
console.log('Published:', page?.published);
console.log('Slug:', page?.slug);

const isBlacklisted = await pageService.isSlugBlacklisted('/my-slug');
console.log('Blacklisted:', isBlacklisted);
```

### File Upload Returns 413 Error

**Diagnosis:**
```bash
curl -X POST http://localhost:4000/api/admin/pages/files \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -F "file=@large-file.mp4"
# Returns: {"error":"File too large","message":"File size 15.23MB exceeds the maximum allowed size of 10.00MB"}
```

**Resolution:**

Increase file size limit via settings API:
```bash
curl -X PATCH http://localhost:4000/api/admin/pages/settings \
  -H "x-admin-token: $ADMIN_API_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"maxFileSize": 52428800}'  # 50MB
```

**Note:** Multer hard limit is 100MB. If you need larger files, modify the Multer configuration in PagesController.

### Rendered HTML Not Updating

**Diagnosis:**
Page content updated but rendered HTML shows old version.

**Cause:**
Redis cache not invalidated after update.

**Resolution:**
```typescript
const page = await pageService.getPageBySlug('/my-slug');
await pageService.invalidatePageCache(page);
```

**Automatic invalidation triggers:**
- Page updated via `updatePage()` (invalidates old and new slug if slug changed)
- Page deleted via `deletePage()`
- Manual via `invalidatePageCache(page)`

### Slug Conflict Errors

**Creating page fails with conflict message:**
```
Error: Slug "/blog" conflicts with redirect from page "Old Blog Posts"
```

**Cause:**
The slug you're trying to use already exists in another page's oldSlugs array, meaning that page owns the redirect for this URL.

**Resolution:**
Choose a different slug or manually remove the conflicting slug from the other page's oldSlugs array via the page editor. To find which page owns the redirect:
```typescript
const conflictingPage = await pageService.findPageByOldSlug('/blog');
console.log(`Slug owned by: ${conflictingPage?.title} (${conflictingPage?._id})`);
```

**Circular reference error:**
```
Error: Cannot set slug to "/old-url" - this is already in the page's redirect history
```

**Cause:**
You're trying to change a page's slug to a value that's already in its own oldSlugs array, which would create a redirect loop.

**Resolution:**
Choose a different slug or remove the conflicting entry from oldSlugs before changing the slug. This validation prevents redirect loops where a page redirects to itself.

### Redirect Not Working

**Old URL returns 404 instead of redirecting:**

**Diagnosis:**
```bash
curl http://localhost:4000/api/pages/old-url
# Returns: 404 Not Found (expected: page data with slug metadata)
```

**Common causes:**
- Old slug not in any page's oldSlugs array (check database)
- Target page is unpublished (redirects only work for published pages)
- oldSlugs index missing (run migration `003_add_old_slugs_to_pages`)
- Frontend not detecting slug mismatch (check requestedSlug vs page.slug comparison)

**Resolution:**
```typescript
// Check if any page has this slug in oldSlugs
const page = await pageService.findPageByOldSlug('/old-url');
if (!page) {
    console.log('No page owns this redirect');
} else if (!page.published) {
    console.log('Target page is unpublished');
} else {
    console.log(`Backend should return page with slug: ${page.slug}`);
    console.log(`Frontend should detect mismatch and redirect`);
}
```

### Storage Provider Errors

**Local storage path resolution issues:**
```
Error: ENOENT: no such file or directory, open '/public/uploads/25/10/image.png'
```

**Cause:**
Uploads directory doesn't exist or incorrect working directory.

**Resolution:**
Verify uploads directory exists and matches expected path:
```bash
ls -la public/uploads/
pwd  # Should be project root
```

The module creates `/public/uploads/` automatically during `init()`, but if running from a different directory, paths will be incorrect.

## Further Reading

**TronRelic module patterns:**
- [system-modules.md](./system-modules.md) - Backend module system architecture and lifecycle patterns
- [system-menu.md](./system-menu.md) - Menu service for navigation management
- [system-database-migrations.md](./system-database-migrations.md) - Database migration system for schema evolution

**Related backend patterns:**
- [plugins/plugins.md](../plugins/plugins.md) - Plugin system architecture (comparison to modules)
- [environment.md](../environment.md) - Environment variable configuration reference
- [documentation.md](../documentation.md) - Documentation standards and writing conventions
