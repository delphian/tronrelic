# Pages Module

The pages module provides custom content management capabilities, allowing administrators to create user-facing pages (articles, documentation, announcements) with markdown authoring and dynamic routing. Pages are rendered from markdown to HTML, cached for performance, and discoverable at URLs matching their configured slugs.

Pages are **managed content** (`core:page`). Every create, read, update, delete, and restore goes through the core content service first, which runs the `content.before*` veto hooks, records who acted, holds a non-curator's change to a reviewed field in `/system/curation`, and serves visitors the last approved version while that change waits. Deletion is soft. See [system-content.md](../../../../docs/system/system-content.md) for the model.

File handling is no longer part of this module. The platform-wide file inventory and upload policy live in the `trp-files` plugin ([README](../../../plugins/trp-files/README.md)) and are published on the service registry as `'files'`.

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
│   ├── 005_strip_file_fields_from_page_settings.ts
│   └── 007_adopt_pages_as_managed_content.ts
├── services/
│   ├── page.service.ts       # IPageService singleton; routes page CRUD and public reads through core
│   ├── page-content-type.ts  # core:page storage callbacks (IManagedContentType)
│   └── markdown.service.ts   # Frontmatter parsing and HTML rendering
├── __tests__/
├── PagesModule.ts            # IModule implementation
├── index.ts
└── README.md
```

**Two-phase lifecycle.** `init()` configures `PageService` with the injected `IContentService` and builds the controller. `run()` registers `core:page` on the core content service, registers the `/system/pages` menu item under the System container, mounts the admin router at `/api/admin/pages`, and the public router at `/api/pages`.

## Managed Content Contract

| Surface | Value |
|---|---|
| Content type id | `core:page` (`PAGE_CONTENT_TYPE_ID`) |
| Classification ceiling | `{ egress: 'user', audience: 'public' }` — public on this platform, never offered to an external sink |
| Reviewed fields | `content`, `title`, `description`, `keywords`, `slug`, `ogImage`, `published` |
| Page identifier | `contentId`, the core-issued UUID; admin routes take it as `:id`. The MongoDB `_id` is internal |
| Who is approved on save | A signed-in admin (`req.adminVia === 'user'`). A write with the `ADMIN_API_TOKEN` service token is recorded as `system:service-token` and held for review |
| Two versions | Top-level document fields hold the latest edit; the `approved` snapshot holds what visitors see |
| Public visibility | Core serves a version (see [system-content.md](../../../../docs/system/system-content.md#the-author-keeps-two-versions)); pages additionally requires that version's `published` flag |
| Soft delete | `deletedAt` on the document and the core row. Slugs and `oldSlugs` of a deleted page stay reserved, since there is no purge |
| Not yet adopted | A page without `contentId` (before migration 007 runs) is served by its own `published` flag and cannot be changed |

**No file dependencies.** Page editors that need attachments use `/system/files` to upload files, then paste the resulting URL into markdown. Pages does not own any file storage.

## Core Components

### PageService (`IPageService`)

Singleton implementing `IPageService`. Owns the `pages` and `page_settings` collections. Page writes and public reads go through the core content service; the service itself handles slug lookups, admin listing, rendering, caching, and the route blacklist.

**Key responsibilities:**

- Page create, update, soft delete, and restore through `IContentService`, carrying the actor
- Public reads (`getPublicPageBySlug`, `findPublicPageByOldSlug`, `renderPublicPageBySlug`, `listSitemapPages`) resolved through `readPublic`, so a page with only a pending edit or a deleted page never reaches a visitor or the sitemap
- Admin listing decorated with review state; filtering by review state asks core for the ids first
- Settings management (route blacklist only)
- Markdown rendering with Redis cache, including a public-render fast path that hits cache before the database

### PageContentType (`IManagedContentType`)

The storage side of `core:page`, called only by the core content service. Parses frontmatter, validates slugs against the blacklist and every other page (including deleted pages and approved snapshots), keeps `oldSlugs` when a slug changes, writes the latest edit, copies it into the `approved` snapshot on `approve`, and soft-deletes by setting `deletedAt`. `discardCreate` removes a page whose create core could not finish (for example, the review hold failed), which frees its slug for a retry. Every storage step drops the render caches for the slugs it touched. A public render that resolved the page just before that step can still write the old version back afterwards, because `ICacheService` has no compare-and-set, so a stale render can survive until the next change to the page or the 24-hour TTL.

### MarkdownService

Parses frontmatter using `gray-matter` and renders markdown to HTML through the `remark`/`rehype` pipeline with `rehype-sanitize` for XSS prevention. Caches rendered HTML in Redis with a 24-hour TTL keyed `page:html:{slug}`.

### PagesController

Admin REST API at `/api/admin/pages` (gated by `requireAdmin`):

- `GET /` — list pages with stats, optional `published`/`search`/`curation`/`deleted`/`limit`/`skip` filters
- `GET /:id` — single page by content id, latest edit
- `POST /` — create page from frontmatter+markdown
- `PATCH /:id` — update page
- `DELETE /:id` — soft-delete page (invalidates cache)
- `POST /:id/restore` — restore a soft-deleted page
- `POST /preview` — render markdown without persisting (live editor preview)
- `GET /settings` — page settings (currently only route blacklist)
- `PATCH /settings` — update settings

Write failures from the core content service map to statuses by their `code`: `not-found` 404, `deleted`/`not-deleted` 409, `vetoed` 403, `curation-unavailable` 503, `superseded` 409; a page validation error is 400.

Public API at `/api/pages`:

- `GET /:slug` — published page metadata (returns redirect data when slug matches `oldSlugs`)
- `GET /:slug/render` — rendered HTML with metadata (cache-first, falls through to redirect on miss)

## Database Schema

### `pages`

```typescript
interface IPageDocument {
    _id: ObjectId;                 // Internal; address pages by contentId
    contentId?: string;            // Core content id; absent until migration 007 adopts the page
    deletedAt?: Date | null;       // Soft delete marker
    approved?: IPageVersionDocument | null; // What visitors see; null until approved
    title: string;                 // Latest edit from here down
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

`IPageVersionDocument` holds the same page fields as the latest edit plus `approvedAt`. The review state and audit fields live on the page's row in the core `content_items` collection, not here.

**Indexes:** `slug` (unique), `oldSlugs`, `published`, `contentId` (unique where present), text index on `title`/`slug`/`description`.

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

Conflict prevention is comprehensive: a new slug cannot collide with another page's current slug or with any page's `oldSlugs`; an `oldSlugs` entry cannot collide with another page's current slug or `oldSlugs`; a slug cannot appear in its own `oldSlugs` (preventing redirect loops). Each check covers both versions of every other page, the latest edit and the `approved` snapshot, because visitors are served the approved version while an edit waits for review.

A rename held for review adds the live slug to `oldSlugs` before anyone approves it. If a curator rejects the rename, the page is still live at that slug. So when an edit without an `oldSlugs` frontmatter field moves the page back to the slug of its approved version, that slug is dropped from the inherited history instead of being refused.

## Migration History

- `module:pages:003_add_old_slugs_to_pages` — added the `oldSlugs` array and its index to the `pages` collection.
- `module:pages:004_files_inventory` — historical, created `module_pages_files` from the legacy `page_files`. The `trp-files` plugin has since moved it to `plugin_files_files`.
- `module:pages:005_strip_file_fields_from_page_settings` — removed file-policy fields from `page_settings` after `module:files:001_files_settings` copied them into the new collection.
- `module:pages:006_add_blog_route_to_blacklist` — added `^/blog(/.*)?$` to the route blacklist in existing `page_settings`, so a CMS page cannot shadow the `trp-blog` plugin's routes.
- `module:pages:007_adopt_pages_as_managed_content` — adopted every existing page as `core:page`: assigned a `contentId`, snapshotted published pages as their approved version, and wrote a core `content_items` row per page (published pages recorded as `approved`, unpublished pages with no review state). Safe to re-run.

## Related Documents

- [Managed Content](../../../../docs/system/system-content.md) — the core content service pages are managed by
- [trp-files README](../../../plugins/trp-files/README.md) — Where the file inventory and upload policy live
- [Backend Modules Overview](../../../../docs/system/modules/modules.md)
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md)
- [Database Access](../../../../docs/system/system-database.md)
