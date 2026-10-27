# Managed Content

Managed content is content whose every create, read, update, delete, and restore passes through the core content service first. Every managed item extends one base type, `IContent`, and gets review, audit, soft deletion, veto hooks, and, when the type opts in, translations from core without implementing any of them itself. Core pages (`core:page`) are the first managed type.

**Every new content type must be managed content**, whether a module or a plugin owns it. Content means an item the platform stores and publishes, on its own pages or to an external destination, such as a page, post, article, or draft. Implement `IManagedContentType`, register it on the `'content'` service, and send every operation through `IContentService`. Do not implement `ICurationType` for a content type, and do not write your own review states, visibility rules, or hard deletes. `ICurationType` remains the contract for holding an effect that is not content.

## Why This Matters

Before managed content, each content owner decided on its own what "reviewed", "visible", and "deleted" meant, and wired curation by hand through its own `ICurationType`. The blog, the curated-memo plugin, and the social-post drafts each invented their own status words, and the `content.published` hook fired from some publish paths and not others. There was no single place to enforce a rule over all content, and nothing stopped an owner from marking its own content approved.

Managed content moves those decisions into core. An owner declares which of its fields a curator must review, and core decides when review is needed, holds the change in the central curation queue, and serves the last approved version to visitors while the change waits. The owner never writes a review state, because review state lives in core's own collection.

## How It Works

### Storage is split in two

Core stores the fields every content type shares — the `IContent` fields — in its own `content_items` collection. The content author (a module or plugin) stores only its type-specific fields in its own collection, keyed by the same `id`. Core never writes into an author's collection, and an author never writes a core field. Translations follow the same split; see [Translations](#translations).

A reader never joins the two by hand. `IContentService` reads the core row, asks the author for the type-specific fields, and returns one merged object. A page read through core is an `IPageContent`: `IContent` plus the page's own fields.

| `IContent` field | Meaning |
|---|---|
| `id` | Core-issued UUID; the single identifier for the item everywhere |
| `typeId` / `providerId` | The managed content type and the module or plugin that registered it |
| `curation` | `pending` / `approved` / `rejected` for the latest edit; absent if the item never entered review |
| `hasApprovedVersion` | Whether a curator has approved some version; while true, visitors see it |
| `curationItemId` | The open curation queue item, while `pending` |
| `holdId` | The current review hold, while `pending`; copied into the queue item's ref so only that item can decide the content |
| `createdAt/By`, `updatedAt/By` | Audit, recorded by core on every operation |
| `deletedAt/By` | Soft deletion; the item is hidden from visitors until restored |

### Every operation goes through core first

A write reaches the core content service, which runs a `content.before*` hook, records the actor, and only then calls the author's method of the same name — `create`, `update`, `delete`, or `restore`. A read goes through `readPublic` or `readAdmin`, which decide which items and which version the author is asked for. The author's methods are storage steps, not entry points. Calling one directly skips the hooks, the audit, and curation.

Core cannot stop a module or plugin from writing to its own collection behind core's back. The platform assumes content authors act in good faith and gives them the safeguards; it does not defend against one that bypasses them. Routing public reads through core limits the damage, because a bypassed write cannot make unapproved content visible.

### Review is decided by core

A managed type lists its `reviewedFields`. On every create and update, core reads the item's latest edit before and after the author writes it, and compares those fields. When one changed:

| Actor | What happens |
|---|---|
| A curator (`isCurator: true` — a signed-in admin) | Approved on the spot. Core asks the author to copy the latest edit into its approved version. If a queue item was open, core approves it through curation so the queue history records the curator. The exception is a type that publishes to destinations, described under [Publishing to destinations](#publishing-to-destinations). |
| Anyone else (the `ADMIN_API_TOKEN` service token, AI tools, plugins) | Held. Core marks the item `pending` and holds it in the central curation queue. Visitors keep seeing the approved version. |

A type with an empty `reviewedFields` list never enters review. A change that touches only unreviewed fields leaves the review state alone.

If a change needs review and the curation service is not running, core refuses the change with the `curation-unavailable` code rather than writing it unreviewed.

### The author keeps two versions

Because an approved item must stay live while an edit waits, the author keeps a **working** version (the latest edit) and an **approved** version (what a curator last approved). `update` only ever changes the working version; core calls `approve` to copy the working version over the approved one. `read` receives a list of `{ id, version }` requests and returns whichever version each asks for.

A public read serves:

| Core row | Served |
|---|---|
| Deleted | Nothing |
| No `curation` (never reviewed) | The working version |
| `hasApprovedVersion: true` | The approved version, whatever the current state |
| `pending` or `rejected` with no approved version | Nothing |

The author still decides what "showing" means for its type. Pages, for example, additionally require the served version's own `published` flag.

### Curation without a curation contract

The curation queue decides items through `ICurationType`. For a managed type, core generates that contract itself (`content-curation-adapter.ts`) and registers it on the `'curation'` service whenever curation is available. A curator's approve or reject in `/system/curation` is forwarded back to the content service, which records the decision and asks the author to promote its working version on approval. Managed items cannot be edited inline in the queue, because an inline edit would skip the core write path; they are edited in their own editor.

More than one queue item can end up open for the same content. Two saves can race and each open one, and a curator's own save approves the content directly when the open item cannot be approved through curation. Each hold therefore gets a fresh `holdId`, stored on the core row and carried in the queue item's ref (`{ id, holdId }`). A decision on an item whose `holdId` is no longer on the row is not applied. Approving one fails with `superseded`, and rejecting one changes nothing.

One existing content type still implements `ICurationType` directly: social posts (`core:social-post`). It must migrate to managed content. Do not model new work on it. (Curated memos, `memo-tracker:curated-memo`, were the other; the `trp-memo-tracker` plugin has been retired and replaced by `trp-relics`, whose `relics:relic` is managed content.)

### Publishing to destinations

A type that sets `publishesToSinks: true` on its `IManagedContentType` gets the curation queue's sink picker. When a curator approves an item there, the queue offers the content router's publish sinks that the type's `classification` allows, such as X or Telegram, and the curator picks which ones fire. Core makes the item live first and hands it to the syndication outbox only after that succeeds, so an approval the content service refuses never publishes anywhere.

Destinations are chosen only on a decision made in the queue, and the queue refuses an approval that selects none. So for such a type, a curator's create or edit is held for review like anyone else's while the item is pending or has never been live: the change is saved, the open queue item shows it, and the curator approves it there with its destinations. Once the item is live and not pending, a curator's edit is approved directly and does not publish it again. Registration refuses a type that sets `publishesToSinks` but declares no `reviewedFields`, because its items would never enter the queue.

### Soft deletion is mandatory

Deleting managed content never removes data, in core's collection or in the author's. The author sets `deletedAt` on its record (`IContentPayloadRecord`) in `delete` and clears it in `restore`, and core marks its row. Deletion is never held for review, but it does pass through `content.beforeDelete`, so a handler can stop it. There is no purge today.

The one exception is a create that fails partway. If the author has stored its record but approving or holding the new item then fails, core calls the author's `discardCreate` and removes its own row, so the caller's error is accurate and a retry does not collide with the leftover record's unique fields. `discardCreate` is never called for an item a caller was told exists.

Deleting an item leaves any open queue item in place. A curator who approves it gets a `deleted` error and nothing is promoted. The queue still records that item as decided, so core drops the hold from the row.

### Recovering an item with no open queue item

The curation queue records a decision before it asks core to apply it. If applying it fails — the item was deleted, or the author's `approve` threw — the queue item is closed but the row is still `pending`. The same happens when the hold itself fails during an update. Core drops the hold in these cases, and treats the next save of a `pending` row with no `curationItemId` as needing a decision even when no reviewed field changed: a curator's save approves it, and anyone else's save opens a new queue item.

### Veto hooks

`content.beforeCreate`, `content.beforeUpdate`, `content.beforeDelete`, and `content.beforeRestore` are `series` hooks carrying an `IContentWriteContext` (`operation`, `typeId`, `id`, `actor`, and the caller's `input` for create and update). A handler that throws `HookAbortError` stops the operation, and the service refuses it with the `vetoed` code and the handler's message. Writes to an item's translations fire the same hooks with `language` set on the context; see [Translations](#translations). Modules register as `'core'` and plugins through `context.hooks`. See [system-hooks.md](./system-hooks.md).

## Translations

Any managed type can be translated, and core runs the workflow for all of them, so a content type does not build its own copy of the stale check, the AI Suggest request, the editor, or the list of translated addresses. A type opts in by setting `translation` on its `IManagedContentType` to an `ITranslatableContentType`. An item is served in a language only while it has a published, live translation into it. There is no fallback to English under a translated address, because serving English text under a translated `<html lang>` and `hreflang` links is what translations exist to prevent.

### Storage is split the same way

Core keeps each translation's state in its own `content_translations` collection: the item and language, `published`, `sourceHash` (a fingerprint of the English text it was saved against), who changed it and when, and soft deletion. It stores no translated text. The content type keeps the translated values in a collection of its own, usually through the store `IContentService.translations().createValueStore(database, collectionName)` hands out, which is bound to the type's own database so a plugin's collection is prefixed like the rest of its storage. Core never writes into that collection; the type's `writeTranslation` and `readTranslations` call the store.

### What the content type supplies

| Member | Purpose |
|---|---|
| `translatableFields` | The fields a translation carries, as `ITranslatableField` (`name`, `label`, `kind`, `required`, optional `hint`). The kind is `text`, `multiline`, `markdown`, `string-list`, or `url`. A `url` field, such as a social image, is never sent to the model and never counts toward the stale check. Append new fields rather than reordering: the order fixes the fingerprint |
| `extractTranslatable(item)` | The English values of those fields, read from an item. Pages strips the frontmatter from its body here |
| `listPublicPaths(item)` | The exact paths an item is served at, or an empty list when the type's own rules hide it. Core drops any path containing `:` or `*`, which the localization snapshot would read as a route pattern |
| `readTranslations`, `writeTranslation` | Load and store translated values, normally by calling the store |
| `onTranslationChanged(id, language)` | Drop anything the type caches for the translated address, such as a rendered page. Must not throw for a cache failure |

### What core does

Translations are not reviewed. Only a curator may save, delete, or restore one, and the change is live at once; anyone else is refused with `forbidden`. A save validates the values against the field list, runs `content.beforeUpdate` with `language` set and the `IContentTranslationWrite` as `input`, stores the values through the type, and records the English fingerprint, which clears the stale flag. Deleting and restoring run `content.beforeDelete` and `content.beforeRestore`. Every change calls the type's `onTranslationChanged` and asks the localization snapshot to rebuild.

The English text translators work from is the version visitors are served, or the latest edit when nothing is served yet. An English edit waiting for review is never shown to translators, because a curator may reject it; the editor is told a `pendingEdit` exists instead. A translation is `stale` when the English fingerprint has changed since it was saved. A stale translation is still served.

`readPublicTranslation(typeId, id, language)` returns the item at its served version with the translated values, or null when either is not served. `listPublishedTranslationIds(typeId, language)` returns the ids of items with a published, live translation into a language, so a translated index page, such as a blog's `/zh/blog`, can list, page, and search just those in the type's own storage. The type applies its own visibility rule, such as a page's `published` flag, and lays the values over the item itself. `listLocalizedRoutes()` collects every published, live translation's paths across all translatable types; bootstrap hands it to the localization module as `listContentRoutes`.

The Suggest request sends the English values of every non-`url` field to the AI provider chosen in the content translation settings, as JSON data the prompt tells the model not to follow, with no tools and no `{%variable%}` expansion. A stale existing translation goes along so the model updates it. The result is never saved; `url` fields carry over from the existing translation. One settings document serves every type and is edited on the System → Localization Settings tab, next to the separate settings for interface text.

### Admin routes and editor

| Method | Path under `/api/admin/content` | Notes |
|---|---|---|
| GET | `/:typeId/translation-status?ids=a,b` | `{ statuses }`: each listed item's `IContentTranslationStatus[]` (language, published, stale, deleted), for an admin list. Reads no translated text; at most `MAX_TRANSLATION_STATUS_IDS` (200) ids |
| GET | `/:typeId/:id/translations` | `IContentTranslationOverview`: the English source with its field list, and every translation including deleted ones |
| PUT | `/:typeId/:id/translations/:language` | Body `IContentTranslationWrite` (`{ values, published }`). Creates or replaces. `forbidden` 403 for the service token |
| DELETE | `/:typeId/:id/translations/:language` | 204, soft delete |
| POST | `/:typeId/:id/translations/:language/restore` | `{ translation }` |
| POST | `/:typeId/:id/translations/:language/suggest` | `IContentTranslationSuggestion`; saves nothing. 503 with no AI provider, 502 for an unusable answer. 20 a minute |
| GET, PATCH | `/translation-settings` | `{ settings }` (`IContentTranslationSettings`) |

The editor is `ContentTranslations` from `src/frontend/modules/content`: one input per declared field with the English value beside it. A type's admin page mounts it for one item and may pass `renderPreview` for its Markdown field. The type's admin list shows `TranslationStatusBadges` beside each item, fed by `getTranslationStatuses`, so how much is translated is visible where the content is managed rather than on the localization page. `/system/pages` is the reference for both.

## Errors

The service throws an Error carrying a `code` from `ContentErrorCode`, so a caller branches on the reason rather than the message.

| Code | Meaning | Pages admin HTTP status |
|---|---|---|
| `unknown-type` | No managed type registered under the id | 500 |
| `not-found` | No item with that id for the type | 404 |
| `deleted` | The item is deleted; restore it first | 409 |
| `not-deleted` | Restore was asked for a live item | 409 |
| `vetoed` | A `content.before*` handler stopped the operation | 403 |
| `curation-unavailable` | The change needs review and curation is not running | 503 |
| `superseded` | A curator approved a queue item that no longer holds the current edit | 409 |
| `forbidden` | The actor may not perform the operation, such as a non-curator importing an approved item | 403 |

An error the author throws (a validation failure such as a slug conflict) passes through unchanged.

## Quick Reference

| Surface | Value |
|---|---|
| Service registry name | `'content'` → `IContentService` |
| Moving records in | `importItem(typeId, input, state, actor)` — creates an item already `approved`, `pending`, or `rejected`; see [Adopting an Existing Type](#adopting-an-existing-type) |
| Constructed | `bootstrapInit` (`src/backend/services/content-service.ts`), before module init |
| Core collection | `content_items` |
| Author contract | `IManagedContentType<T, TCreate, TUpdate>` — `classification`, `reviewedFields`, optional `publishesToSinks`, `describe`, `create`, `discardCreate`, `read`, `update`, `delete`, `restore`, `approve` |
| Actor for admin routes | `actorFromAdminRequest(req)` (`src/backend/services/content-actor.ts`): a signed-in admin is a curator; the service token is `system:service-token` and is not |
| Hooks | `content.beforeCreate` / `beforeUpdate` / `beforeDelete` / `beforeRestore` (series); translation writes set `language` |
| Translations | `IContentService.translations()` → `IContentTranslationService`; state in `content_translations`, values in the type's own collection; settings in `content_translation_settings`; admin routes at `/api/admin/content` |
| Types | `@delphian/tronrelic-types` → `IContent`, `IManagedContentType`, `IContentService`, `IContentActor`, `IContentPayloadRecord`, `ContentCurationState`, `ContentVersion`, `ContentErrorCode`, `ITranslatableContentType`, `ITranslatableField`, `IContentTranslationService` |
| Managed types today | `core:page` (Pages module), translatable; `blog:post` (`trp-blog` plugin), translatable and publishes to sinks; `relics:relic` (`trp-relics` plugin), publishes to sinks |

## Adopting an Existing Type

Adopting a type that already has records takes a migration, because every existing record needs a core-issued id and a core row. The pages migration `module:pages:007_adopt_pages_as_managed_content` is the reference: it assigns each record a `contentId`, snapshots currently published content as its approved version so nothing live disappears, and upserts a core row per record, recording live content as `approved` and everything else with no review state. Migrations run when an operator starts them, so the author must keep serving its not-yet-adopted records by their old rules until then.

A plugin cannot write `content_items`, so it cannot adopt records the way that migration does. A plugin moving records in from elsewhere, such as an older plugin it replaces, calls `IContentService.importItem(typeId, input, state, actor)` once per record instead. It writes the item as `create` does, runs the same `content.beforeCreate` hooks, and then places it in the state the record already had rather than deciding again: `approved` goes live, `pending` is held in the curation queue, and `rejected` is stored hidden. Nothing is sent to a publish sink and `content.published` does not fire, because the record was already reviewed where it came from. Only a curator may import an item as `approved`, and a type with no reviewed fields cannot be imported, since `create` already makes its items live.

`trp-blog` is the plugin reference for adopting its own older records this way. On each start, `adoptLegacyPosts` imports every post still in the old format in the state it had, as a `system:` actor that is a curator because the posts were approved before the move. The type's `create` attaches the existing record to the new id rather than copying it, and its `discardCreate` undoes the attachment if core cannot finish, so the next start retries. A record is not served until it is adopted, which takes a few seconds on the first start after an upgrade.

## Further Reading

- [system-curation.md](./system-curation.md) — the curation queue managed items are held in, and the older `ICurationType` contract
- [system-content-types.md](./system-content-types.md) — the content-type registry; a managed type is also an ordinary `IContentType`
- [system-hooks.md](./system-hooks.md) — hook archetypes and how to register a veto handler
- [Pages README](../../src/backend/modules/pages/README.md) — the first managed type, `core:page`
