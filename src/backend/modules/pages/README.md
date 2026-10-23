# Pages Module

The pages module provides custom content management capabilities, allowing administrators to create user-facing pages (articles, documentation, announcements) with markdown authoring and dynamic routing. Pages are rendered from markdown to HTML, cached for performance, and discoverable at URLs matching their configured slugs.

Pages are **managed content** (`core:page`). Every create, read, update, delete, and restore goes through the core content service first, which runs the `content.before*` veto hooks, records who acted, holds a non-curator's change to a reviewed field in `/system/curation`, and serves visitors the last approved version while that change waits. Deletion is soft. See [system-content.md](../../../../docs/system/system-content.md) for the model.

A page can also have **translations** (`core:page-translation`), one per language, which are managed content of their own. A page is served in another language only while it has a published translation into it; see [Translations](#translations).

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
│   ├── page-translations.controller.ts # Translation CRUD and translated public reads
│   ├── sendContentWriteError.ts # Content-error-to-HTTP-status mapping both controllers share
│   ├── pages.routes.ts       # Admin router factory
│   └── pages.public-routes.ts # Public router factory
├── database/
│   ├── IPageDocument.ts      # Page model with frontmatter fields
│   ├── IPageSettingsDocument.ts # Page-only settings (route blacklist)
│   ├── IPageTranslationDocument.ts # Translation model
│   ├── ensurePageTranslationIndexes.ts # Translation collection name and boot-time indexes
│   └── index.ts
├── migrations/
│   ├── 003_add_old_slugs_to_pages.ts
│   ├── 005_strip_file_fields_from_page_settings.ts
│   └── 007_adopt_pages_as_managed_content.ts
├── services/
│   ├── page.service.ts       # IPageService singleton; routes page CRUD and public reads through core
│   ├── page-content-type.ts  # core:page storage callbacks (IManagedContentType)
│   ├── page-translation.service.ts # IPageTranslationService singleton
│   ├── page-translation-content-type.ts # core:page-translation storage callbacks
│   ├── page-translation-suggestion.service.ts # AI Suggest request for the translation editor
│   ├── page-translation-prompt.ts # Pure prompt builder, reply parser, and markdown assembler
│   ├── page-translation-errors.ts # Unavailable (503) and provider (502) errors for Suggest
│   └── markdown.service.ts   # Frontmatter parsing and HTML rendering
├── __tests__/
├── ai-tools.ts               # Read-only AI tools: pages-list, pages-search, pages-get
├── PagesModule.ts            # IModule implementation
├── index.ts
└── README.md
```

**Two-phase lifecycle.** `init()` configures `PageService` and `PageTranslationService` with the injected `IContentService`, creates the translation indexes, and builds the controllers. `run()` registers `core:page` and `core:page-translation` on the core content service, registers the `/system/pages` menu item under the System container, mounts the admin router at `/api/admin/pages` and the public router at `/api/pages`, and watches the service registry for `'ai-tools'` so the page AI tools register whenever that registry is available.

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
- Public reads (`getPublicPageBySlug`, `findPublicPageByOldSlug`, `renderPublicPageBySlug`, `listSitemapPages`, `listPublicPages`, `getPublicPages`) resolved through `readPublic`, so a page with only a pending edit or a deleted page never reaches a visitor, the sitemap, or an AI tool
- `listPublicPages` and `getPublicPages` return `IPublicPage` from `@/types`: the served version reduced to id, slug, title, description, keywords, Open Graph image, and the markdown body with its frontmatter, HTML comments, and scripts removed. The listing loads every visible page and filters in memory, because only core knows which of a page's two stored versions a visitor is served, so a database search could match text no visitor sees
- Admin listing decorated with review state; filtering by review state asks core for the ids first
- Settings management (route blacklist only)
- Markdown rendering with Redis cache, including a public-render fast path that hits cache before the database

### PageContentType (`IManagedContentType`)

The storage side of `core:page`, called only by the core content service. Parses frontmatter, validates slugs against the blacklist and every other page (including deleted pages and approved snapshots), keeps `oldSlugs` when a slug changes, writes the latest edit, copies it into the `approved` snapshot on `approve`, and soft-deletes by setting `deletedAt`. `discardCreate` removes a page whose create core could not finish (for example, the review hold failed), which frees its slug for a retry. Every storage step drops the render caches for the slugs it touched. A public render that resolved the page just before that step can still write the old version back afterwards, because `ICacheService` has no compare-and-set, so a stale render can survive until the next change to the page or the 24-hour TTL.

### MarkdownService

Parses frontmatter using `gray-matter` and renders markdown to HTML through the `remark`/`rehype` pipeline with `rehype-sanitize` for XSS prevention. Caches rendered HTML in Redis with a 24-hour TTL keyed `page:html:{slug}`.

`stripHiddenMarkup` removes HTML comments and `<script>` elements from markdown, the two things the sanitizer hides from visitors along with their contents. Every public read that returns markdown instead of HTML passes through it, so markdown cannot reveal a note an author left in a comment. It works on the raw HTML the parser finds, which keeps a comment written inside a code block (the page shows that one), and it edits the original text rather than re-serializing, so all other formatting stays as written.

### PagesController

Admin REST API at `/api/admin/pages` (gated by `requireAdmin`):

- `GET /` — list pages with stats, optional `published`/`search`/`curation`/`deleted`/`limit`/`skip` filters
- `GET /:id` — single page by content id, latest edit
- `POST /` — create page from frontmatter+markdown
- `PATCH /:id` — update page
- `DELETE /:id` — soft-delete page (invalidates cache)
- `POST /:id/restore` — restore a soft-deleted page
- `POST /preview` — render markdown without persisting (live editor preview)
- `GET /settings` — page settings: the route blacklist and the page translation AI settings
- `PATCH /settings` — update settings. Changing `translationProviderId` without `translationModel` clears the model, because a model id only means something on its own provider

Write failures from the core content service map to statuses by their `code`: `not-found` 404, `deleted`/`not-deleted` 409, `vetoed` 403, `curation-unavailable` 503, `superseded` 409; a page validation error is 400.

Public API at `/api/pages`:

- `GET /:slug` — published page metadata: `title`, `slug`, `description`, `keywords`, `ogImage`, `createdAt`, and `updatedAt`, plus `requestedSlug`, which differs from `page.slug` when the request matched an old slug. Nothing else leaves the server: not the markdown source, which can hold comments the rendered page hides, and not the redirect history or review state
- `GET /:slug/render` — rendered HTML with metadata (cache-first, falls through to redirect on miss)

Both public endpoints answer an unexpected failure with a 500 carrying only a generic `error` string. The caller is anonymous, so the underlying message, which can name hosts, collections, or query details, goes only to the log under the `tronrelic:pages` service.

## AI Tools

`ai-tools.ts` registers three read-only tools on the core `'ai-tools'` registry under provider id `pages`. They read through `listPublicPages` and `getPublicPages`, so they return only what a visitor sees: drafts, edits waiting for review, and deleted pages never reach them.

| Tool | Input | Returns |
|---|---|---|
| `pages-list` | `page` (1-based, default 1), `limit` (default 20, at most 50) | `total`, `page`, `limit`, `hasMore`, and `pages[]` of `{ id, slug, title, description, keywords, updatedAt, excerpt }`, with no body |
| `pages-search` | `query` (1–100 characters), `page`, `limit` | The same, filtered by a case-insensitive literal substring of the title, slug, description, keywords, or body |
| `pages-get` | `pages`: 1–5 entries, each a content id, a slug starting with `/`, or a full URL reduced to its path | `pages[]` of `{ requested, found, page }` in the order asked. `page` carries the markdown body without frontmatter, HTML comments, or scripts, cut to 20,000 characters with `truncated` and `totalCharacters` when cut, or is null when no published page answers. An old slug resolves to the page at its current slug |

All three declare `{ sideEffect: 'read', reversible: true, sensitivity: 'public' }`. That passes the MCP safety floor, so an admin can grant them to any user group on `/system/mcp`, and they may run in scheduled prompts. They do not declare `surfacesUntrustedContent`, because every served version was written or approved by a curator. A page not yet adopted by migration 007 has a null `id` and is read by slug.

Blog posts are not pages. The `trp-blog` plugin has its own `list-blog-posts`, `search-blog-posts`, and `get-blog-post` tools. The tools return English pages only; translations are not exposed to them.

## Translations

A translation holds one page's visitor-facing text in one language. It has no slug of its own: the Chinese translation of `/about` is served at `/zh/about`, which is the address the localization module's prefix rule already gives that path. Translations are the per-page opt-in to a language. A page without a published translation into a language gets no translated address, no `hreflang` link, no translated sitemap entry, and no entry in the language switcher.

| | |
|---|---|
| Content type id | `core:page-translation` (`PAGE_TRANSLATION_CONTENT_TYPE_ID`) |
| Service | `PageTranslationService` (`IPageTranslationService` in `@/types`), singleton. Not published on the service registry |
| Admin UI | `/system/pages` → a page's **Translations** button: one row per language configured on `/system/localization`, and a side-by-side editor with the English markdown from `getTranslationSource` |
| Storage | `module_pages_translations`; unique `(pageId, language)` across live and deleted documents, unique `contentId` |
| Reviewed fields | `content`, `title`, `description`, `keywords`, `ogImage`, `published`. `sourceHash` is not reviewed |
| Classification ceiling | `{ egress: 'user', audience: 'public' }`, the same as a page |
| Served when | The page is served at that slug, the translation's served version is `published: true`, and the language is enabled |

**Frontmatter.** A translation is markdown with frontmatter like a page. `title` is required; `description`, `keywords`, `ogImage`, and `published` are optional. Without `ogImage` the page's image is used. `slug` and `oldSlugs` are ignored. The editor starts a new translation from the English frontmatter and body with `published: false`, so saving a half-finished translation never puts it live.

**Stale flag.** Each save stores `sourceHash`, a SHA-256 of the English page's title, description, keywords, and body at the version visitors are served (the latest edit when none is served yet). `IPageTranslation.stale` is true when the English page's current hash differs. Changing only the English slug or `published` flag does not mark translations stale. A stale translation is still served; saving it again, even unchanged, clears the flag.

**One English source.** `getTranslationSource` returns that same English version as an `IPageTranslationSource`, and the editor shows it and starts new drafts from it, so the editor, Suggest, and the stale flag all work from one text. An English edit waiting for review is never shown to translators, because a curator may reject it. Instead `pendingEdit` is true when such an edit changes the title, description, keywords, or body, and the editor warns that translations will be marked stale once it is approved.

**No English fallback.** A translated request for a page with no visible, published translation into that language is a 404, never the English body. Serving English text under a translated `<html lang>` and `hreflang` links is what this feature exists to prevent. The same applies when an administrator publishes a route pattern covering a CMS page on the localization Routes tab: requests in that language now 404 until the page has a translation.

**Localization snapshot.** Bootstrap passes `PageTranslationService.listLocalizedRoutes()` to the localization module as `listContentRoutes`. It returns one route per page slug and per old slug that has a published translation, so a translated link to a renamed page still reaches the redirect. An old slug containing anything but `a-z`, `0-9`, `-`, and `/` is left out, because `:` or `*` would turn the exact address into a route pattern covering other pages. Each page or translation change that can alter what is served calls `onLocalizedRoutesChanged`, which bootstrap points at `LocalizationService.invalidate()`. That includes approvals from the curation queue, which reach the module only through the content types' `approve` step. The localization service also rebuilds a snapshot containing content routes after 60 seconds, which bounds the case where an approval finishes after the rebuild it asked for.

**AI suggestions.** The editor's **Suggest** button sends the English page to an AI model and places the translation it returns in the editor. Nothing is saved: the administrator reviews the text and saves it as usual. It works the same way as the localization module's Suggest buttons, and shares their code for choosing the provider (`src/backend/services/resolveAiProvider.ts`) and for accepting only a finished answer (`src/backend/services/runIsolatedAiQuery.ts`).

| | |
|---|---|
| Settings | Pages Settings tab → **AI translation**: the provider and model (`translationProviderId`, `translationModel`; null means the active provider and its default model) and the system prompt (`translationSystemPrompt`, defaulting to `DEFAULT_PAGE_TRANSLATION_SYSTEM_PROMPT`). Stored on the `page_settings` document, separate from the localization module's settings, because articles and interface strings usually want different instructions |
| What is sent | The English title, description, keywords, and body at the version visitors are served, as JSON data the prompt tells the model not to follow. A stale existing translation is sent as `previousTranslation` so the model updates it; a current one is not, because the model would only copy it |
| How it runs | `PageTranslationSuggestionService` resolves the provider from the core `'ai-providers'` registry and the language names from `ILocalizationService.getLanguage`, both per request. The call uses `toolAllowlist: []`, `expandVariables: false`, and `thinkingBudget: 0`. Only an `end_turn` or `stop_sequence` stop is parsed; anything else is a 502 |
| What comes back | `IPageTranslationSuggestionResult`: the translation as markdown (`page-translation-prompt.ts` builds the frontmatter, carrying `published` and `ogImage` over from the existing translation so a suggestion never puts a page live), the model's `notes`, and `providerId`, `model`, `costUsd`, and `usage` |
| Toast | The same `SuggestionSummary` body the localization Translations tab shows: the model's notes and the cost with token counts. It stays open when the model left notes |
| Limits | 20 requests a minute on top of the admin limiter, since each one is a paid call. The output budget grows with the page and stops at 16,000 tokens; a page too long for that is reported as a 502 saying so |
| Audit | Every run is logged under `tronrelic:pages` with the actor, page, language, model, token usage, and cost |

**Render cache.** A translation's render is cached under `page:render-translation:{language}:{slug}` with the tag `page:translations:{slug}`. `MarkdownService.invalidateAllCaches(slug)` clears that tag along with the English keys, so any change to the page or one of its translations drops every language's render at that slug.

### Translation REST

Admin, under `/api/admin/pages` (`requireAdmin`). `:id` is the page's content id. Errors follow the page routes: the content error codes map to statuses, and a validation error is 400.

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/:id/translations` | — | `{ translations: IPageTranslation[], source: IPageTranslationSource }`. `translations` includes deleted ones, ordered by language; `source` is the English text they follow |
| POST | `/:id/translations` | `{ language, content }` | `{ translation }` 201. Refused for `en`, a malformed code, a deleted page, or a language the page already has (restore a deleted one instead) |
| PATCH | `/:id/translations/:language` | `{ content }` | `{ translation }` |
| DELETE | `/:id/translations/:language` | — | 204, soft delete |
| POST | `/:id/translations/:language/restore` | — | `{ translation }` |
| POST | `/:id/translations/:language/suggest` | — | `IPageTranslationSuggestionResult`; saves nothing. 404 for an unknown page or a language not configured on `/system/localization`, 503 when no AI provider can run it, 502 when the model's answer cannot be used. Limited to 20 a minute |

Public: `GET /api/pages/:slug?language=<code>` and `GET /api/pages/:slug/render?language=<code>` answer with the translation in the same shapes as the English endpoints, following an old slug to the page's current one. Without `language`, or with `language=en`, the request reaches the English handler unchanged. The site's catch-all route adds the parameter on translated requests.

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

**Indexes:** `oldSlugs` (migration 003), `contentId` (unique where present, migration 007), `text_search`, the text index on `title`/`slug`/`description` that the admin list's `search` filter needs (migration 008), and `slug_1`, unique across every page including soft-deleted ones (migration 009). Every index here is created by a migration; the module creates none at boot. The Mongoose schema this collection had before the move to the native driver (commit 4e4c9d9a) also declared `published` and `{ published: 1, createdAt: -1 }`; those only sped up queries on a collection of a few dozen pages and were not restored.

`PageContentType.assertSlugsAvailable` remains the main slug guard, because it also checks approved snapshots and redirect history, which a single index cannot. The unique index catches the one case the check cannot: two saves of the same slug arriving together. `toSlugConflictError` turns that refusal into the check's own message, "A page with slug … already exists".

**Validation rules:** slug must start with `/`, must not match a blacklist pattern, must not collide with another page's `slug` or `oldSlugs`, must not appear in its own `oldSlugs` (no circular redirects). Title is required.

### `module_pages_translations`

```typescript
interface IPageTranslationDocument {
    _id: ObjectId;                 // Internal; address by contentId, or by pageId + language
    contentId: string;             // The translation's own core content id
    deletedAt: Date | null;        // Soft delete marker
    approved: IPageTranslationVersionDocument | null; // What visitors see
    pageId: string;                // Content id of the page translated
    language: string;              // Language code, never 'en'
    title: string;                 // Latest edit from here down
    content: string;               // Full markdown including frontmatter
    description: string;
    keywords: string[];
    published: boolean;
    ogImage: string | null;
    sourceHash: string;            // English text this edit was written against
    createdAt: Date;
    updatedAt: Date;
}
```

**Indexes:** `contentId` (unique) and `(pageId, language)` (unique), created at boot by `ensurePageTranslationIndexes`. Unlike `pages`, this collection was new when it was introduced, so there were no existing documents for a migration to adapt, and creating the indexes at boot makes the uniqueness rule hold from the first write.

### `page_settings`

```typescript
interface IPageSettingsDocument {
    _id: ObjectId;
    blacklistedRoutes: string[];  // Regex patterns
    translationSystemPrompt?: string;      // Absent: the built-in default
    translationProviderId?: string | null; // Absent or null: the active provider
    translationModel?: string | null;      // Absent or null: the provider's default
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
- `module:pages:008_restore_pages_text_index` — restored the `text_search` text index the Mongoose schema used to build, without which the `/system/pages` search fails with "text index required for $text query". One `createIndex` call after read-only checks; a no-op when the same index exists, and refuses, without writing, when a different text index exists.
- `module:pages:009_restore_pages_slug_unique_index` — restored the unique `slug_1` index the Mongoose schema used to build, so two pages can never be stored under one URL. One `createIndex` call after read-only checks; a no-op when the unique index exists, and refuses, without writing, when pages already share a slug (listing them) or when a non-unique `slug_1` exists.

## Related Documents

- [Managed Content](../../../../docs/system/system-content.md) — the core content service pages are managed by
- [trp-files README](../../../plugins/trp-files/README.md) — Where the file inventory and upload policy live
- [Backend Modules Overview](../../../../docs/system/modules/modules.md)
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md)
- [Database Access](../../../../docs/system/system-database.md)
