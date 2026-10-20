# Pages Module Test Suite

Tests for the pages module. Pages are managed content (`core:page`), so the service tests run against the real core `ContentService` with an in-memory database, rather than a mock of it. That keeps the tests honest about the behaviour visitors actually see: review holds, the approved version staying live while an edit waits, and soft deletion.

The core content service has its own suite at `src/backend/services/__tests__/content-service.test.ts`, covering create, update, curation decisions, the `content.before*` veto hooks, soft delete and restore, and listing.

## Test Files

| File | What it covers |
|------|----------------|
| `page.service.test.ts` | `PageService` wired to a real `ContentService` and a mock curation service. Create (frontmatter parsing, content id issued, a curator's page approved at once, a service-token page held for review, slug generation, missing title, slug conflicts, a racing duplicate refused by the unique slug index reported as a plain slug conflict while other write failures pass through, blacklisted slugs). Update (`oldSlugs` kept on rename, moving back to the live slug after a rejected rename, unknown id refused with `not-found`, the approved page still served while a service-token edit waits). Public reads by slug and old slug, unpublished pages hidden, and pages not yet adopted by migration 007 served by their own `published` flag. `listPublicPages` (visible pages only, search over the served version rather than a held edit, literal matching that ignores frontmatter, paging) and `getPublicPages` (by id, current slug, and old slug in the order asked, null for drafts, deleted, held-only, and unknown pages, HTML comments removed from the body). Admin listing with review state, stats, soft delete and restore, sitemap listing, settings, `sanitizeSlug`, and `isSlugBlacklisted` |
| `pages.controller.test.ts` | `PagesController` HTTP handlers: list, get, create, update, soft delete, restore, markdown preview, settings, and the public endpoints. Also checks that a signed-in admin is passed as a curator actor and the service token as a non-curator, that content service error codes map to HTTP statuses (403 veto, 404 not found, 409 not deleted), that the public metadata endpoint returns only the fields the page route uses, never the markdown or review state, and that both public endpoints answer a failure with a generic 500 while logging the error |
| `pages.module.test.ts` | `PagesModule` metadata, the `init()` and `run()` split (routes, menu, and AI tool registration only in `run()`, `core:page` registered on the content service, the tools registered when `'ai-tools'` appears later), and error handling |
| `pages.ai-tools.test.ts` | The `pages-list`, `pages-search`, and `pages-get` tools over a fake service: names and public read capability, summaries without bodies, paging, id, slug, and URL normalization, the body cap, input errors the model can correct from, and service failures reported without detail |
| `008_restore_pages_text_index.test.ts` | Migration 008 over a fake `pages` collection: builds `text_search` when there is no text index, does nothing when the same index exists, and refuses a different text index without calling `createIndex` |
| `009_restore_pages_slug_unique_index.test.ts` | Migration 009 over a fake `pages` collection: builds the unique `slug_1` when no slugs are shared, does nothing when it exists, and refuses without calling `createIndex` when pages share a slug or a non-unique `slug_1` exists |
| `markdown.service.test.ts` | `MarkdownService` frontmatter parsing, markdown rendering with GitHub Flavored Markdown and HTML sanitization, `stripHiddenMarkup` (block and inline comments, inline and block scripts, an unclosed script hiding the rest of the page, a script closed in a later paragraph keeping the text after it, comments inside code kept, other formatting untouched), and the Redis render cache (get, set, invalidate) |

File storage is not tested here, because the `trp-files` plugin owns it. See [its README](../../../../plugins/trp-files/README.md).

## Running the Tests

```bash
npm test -- src/backend/modules/pages/__tests__/
npm test -- src/backend/services/__tests__/content-service.test.ts
```

## Mocks

- `createMockDatabaseService` (`src/backend/tests/vitest/mocks/database-service.ts`) — in-memory MongoDB with filters, sorting, and pagination
- `createMockServiceRegistry` (`src/backend/tests/vitest/mocks/service-registry.ts`) — supplies a mock `'curation'` service to the content service
- `MockCacheService` — in-memory Redis stand-in with pattern invalidation, defined in `page.service.test.ts`

See [system-testing.md](../../../../../docs/system/system-testing.md) for the shared mocking patterns.
