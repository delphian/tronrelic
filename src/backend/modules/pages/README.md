# Pages Module

The pages module provides custom content management capabilities, allowing administrators to create user-facing pages (articles, documentation, announcements) with markdown authoring and dynamic routing. Pages are rendered from markdown to HTML, cached for performance, and discoverable at URLs matching their configured slugs.

File handling is no longer part of this module. The platform-wide file inventory and upload policy live in the Files module ([../files/README.md](../files/README.md)) and are published on the service registry as `'files'`.

## Why This Matters

TronRelic's plugin system excels at blockchain-specific features, but administrators need simpler content pages for documentation, announcements, or marketing content. Without the pages module:

- **Content scattered across codebases** — Static pages require code changes, pull requests, and deployments for every update.
- **No admin control** — Content creators depend on developers for every text change.
- **Rigid routing** — Adding new pages requires modifying Next.js routing configuration.
- **Performance overhead** — Rendering markdown on every request wastes CPU cycles and slows page loads.
- **SEO limitations** — No structured metadata management for search engines and social sharing.

The pages module solves these by providing:

- **Database-backed storage** — Pages and settings persist in MongoDB without code deployments.
- **Frontmatter metadata** — SEO fields (title, description, keywords, Open Graph images) extracted from YAML blocks.
- **Redis-cached HTML** — Rendered markdown caches for 24 hours, reducing CPU load by avoiding repeated parsing.
- **Route conflict prevention** — Blacklist patterns prevent pages from overriding `/api` or `/system` routes.
- **Dynamic slug routing** — Pages appear at configured URLs without frontend configuration changes.
- **Automatic redirect preservation** — Old URLs redirect to current locations when slugs change, preserving SEO value.

## Architecture Overview

```
modules/pages/
├── api/
│   ├── pages.controller.ts   # Page CRUD, preview, settings, public render
│   ├── pages.routes.ts       # Admin router factory
│   └── pages.public-routes.ts # Public router factory
├── database/
│   ├── IPageDocument.ts      # Page model with frontmatter fields
│   ├── IPageSettingsDocument.ts # Page-only settings (route blacklist)
│   └── index.ts
├── migrations/
│   ├── 003_add_old_slugs_to_pages.ts
│   └── 005_strip_file_fields_from_page_settings.ts
├── services/
│   ├── page.service.ts       # IPageService singleton
│   └── markdown.service.ts   # Frontmatter parsing and HTML rendering
├── __tests__/
├── PagesModule.ts            # IModule implementation
├── index.ts
└── README.md
```

**Two-phase lifecycle.** `init()` configures `PageService` and builds the controller. `run()` registers the `/system/pages` menu item under the System container, mounts the admin router at `/api/admin/pages`, and the public router at `/api/pages`.

**No file dependencies.** Page editors that need attachments use `/system/files` to upload files, then paste the resulting URL into markdown. Pages does not own any file storage.

## Core Components

### PageService (`IPageService`)

Singleton implementing the service-registry contract. Owns the `pages` and `page_settings` collections, parses frontmatter on create/update, validates slugs against the blacklist and existing pages (including `oldSlugs` redirects), and renders markdown to HTML through `MarkdownService` with Redis caching.

**Key responsibilities:**

- Page CRUD with frontmatter parsing
- Slug sanitization and uniqueness validation
- `oldSlugs` preservation when slugs change (for 301-style redirects)
- Settings management (route blacklist only)
- Markdown rendering with Redis cache, including a public-render fast path that hits cache before the database

### MarkdownService

Parses frontmatter using `gray-matter` and renders markdown to HTML through the `remark`/`rehype` pipeline with `rehype-sanitize` for XSS prevention. Caches rendered HTML in Redis with a 24-hour TTL keyed `page:html:{slug}`.

### PagesController

Admin REST API at `/api/admin/pages` (gated by `requireAdmin`):

- `GET /` — list pages with stats, optional `published`/`search`/`limit`/`skip` filters
- `GET /:id` — single page by ID
- `POST /` — create page from frontmatter+markdown
- `PATCH /:id` — update page
- `DELETE /:id` — delete page (invalidates cache)
- `POST /preview` — render markdown without persisting (live editor preview)
- `GET /settings` — page settings (currently only route blacklist)
- `PATCH /settings` — update settings

Public API at `/api/pages`:

- `GET /:slug` — published page metadata (returns redirect data when slug matches `oldSlugs`)
- `GET /:slug/render` — rendered HTML with metadata (cache-first, falls through to redirect on miss)

## Database Schema

### `pages`

```typescript
interface IPageDocument {
    _id: ObjectId;
    title: string;
    slug: string;                  // Current URL path (unique)
    oldSlugs: string[];            // Previous slugs that redirect here
    content: string;               // Full markdown including frontmatter
    description: string;
    keywords: string[];
    published: boolean;
    ogImage: string | null;
    authorId: string | null;       // Reserved for future multi-author
    createdAt: Date;
    updatedAt: Date;
}
```

**Indexes:** `slug` (unique), `oldSlugs`, `published`, text index on `title`/`slug`/`description`.

**Validation rules:** slug must start with `/`, must not match a blacklist pattern, must not collide with another page's `slug` or `oldSlugs`, must not appear in its own `oldSlugs` (no circular redirects). Title is required.

### `page_settings`

```typescript
interface IPageSettingsDocument {
    _id: ObjectId;
    blacklistedRoutes: string[];  // Regex patterns
    updatedAt: Date;
}
```

File-related fields (`maxFileSize`, `allowedFileExtensions`, `filenameSanitizationPattern`, `storageProvider`) were removed by migration `module:pages:005_strip_file_fields_from_page_settings` after `module:files:001_files_settings` copied them into the Files module's settings collection.

## Automatic Redirect System

When a page slug changes, the previous slug is appended to `oldSlugs` automatically. Visitors hitting an old slug receive page data carrying both `requestedSlug` and the current `page.slug`; the frontend catch-all route compares the two and triggers a `redirect()`. The `oldSlugs` index makes the lookup sub-millisecond at thousands-of-pages scale, and the redirect check only runs on slug misses, so normal page loads pay zero overhead.

Conflict prevention is comprehensive: a new slug cannot collide with another page's current slug or with any page's `oldSlugs`; an `oldSlugs` entry cannot collide with another page's current slug; a slug cannot appear in its own `oldSlugs` (preventing redirect loops).

## Migration History

- `module:pages:003_add_old_slugs_to_pages` — added the `oldSlugs` array and its index to the `pages` collection.
- `module:pages:004_files_inventory` — historical, created `module_pages_files` from the legacy `page_files`. The Files module now owns this collection.
- `module:pages:005_strip_file_fields_from_page_settings` — removed file-policy fields from `page_settings` after `module:files:001_files_settings` copied them into the new collection.

## Related Documents

- [Files Module README](../files/README.md) — Where the file inventory and upload policy live
- [Backend Modules Overview](../../../../docs/system/modules/modules.md)
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md)
- [Database Access](../../../../docs/system/system-database.md)
