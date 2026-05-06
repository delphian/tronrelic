# Files Module

The files module owns the platform-wide file inventory: every file the system stores — admin page attachments, plugin-generated images, future imports — flows through one service with one collection and one upload policy. It publishes `IFileService` on the service registry as `'files'` so consumers do not need a hard import dependency on this module's bootstrap order.

## Why This Matters

Before the split, the Pages module owned both page CRUD and the file inventory. That entanglement meant uploads, settings, and the storage backend were colocated with markdown rendering and slug routing — two distinct lifecycles, two distinct admin surfaces, sharing a directory and a settings document. Splitting them keeps responsibilities aligned: page concerns live with pages, file concerns live with files, and either subsystem can evolve without dragging the other along.

Without a unified file module:

- **Inventory drift** — Plugins maintain shadow file collections that diverge in schema, listing semantics, and disk layout.
- **Policy drift** — Upload limits and extension whitelists live on `page_settings`, applied only when uploads go through the Pages module, leaving plugins free to ignore them.
- **Storage swap pain** — Every consumer that imports `IStorageProvider` directly has to be updated to swap local FS for S3.
- **Operator opacity** — No single answer to "what files does the platform have, and where?" — operators have to query each owner's collection and reconcile.

This module solves these by making `IFileService` the single source of truth, source-tagging every row at upload time so per-source listing stays cheap, and centralizing upload policy on `module_files_settings`.

## Architecture Overview

```
modules/files/
├── api/
│   ├── files.controller.ts   # /api/admin/files — list, upload, delete, settings
│   └── files.routes.ts       # Admin router factory
├── database/
│   ├── IFileDocument.ts      # Inventory document shape
│   ├── IFilesSettingsDocument.ts # Settings document + defaults
│   └── index.ts
├── migrations/
│   └── 001_files_settings.ts # Seed module_files_settings from page_settings
├── services/
│   ├── file.service.ts       # IFileService singleton, owns inventory + policy enforcement
│   ├── files-settings.service.ts # IFilesSettingsService singleton
│   └── storage/
│       ├── StorageProvider.ts      # Abstract IStorageProvider base class
│       └── LocalStorageProvider.ts # Default local FS implementation
├── __tests__/
│   ├── files.module.test.ts
│   └── storage.test.ts
├── FilesModule.ts            # IModule implementation
├── index.ts
└── README.md
```

**Two-phase lifecycle.** `init()` constructs the storage provider, configures both singletons, and builds the admin controller. `run()` publishes `IFileService` on the registry, registers the `/system/files` menu item under the System container, and mounts the admin router.

**Bootstrap order.** `FilesModule.init()` runs before `PagesModule.init()` so consumers of `'files'` see one consistent inventory once both modules' `run()` phases complete. PagesModule no longer constructs `FileService` itself.

## Core Components

### FileService (`IFileService`)

Singleton implementing the service-registry contract `'files'`. Owns the `module_pages_files` collection (historical name retained from migration `module:pages:004_files_inventory`), generates UUIDs at upload time, validates against `IFilesSettingsService` policy, writes through the injected `IStorageProvider`, and rolls bytes back if the inventory insert fails. The path layout `<kind>/<sourceId>/YY/MM/<uuid>.<ext>` is built here, not in the storage provider — keeping the database row and the on-disk path designed together so operators can `du` per source.

### FilesSettingsService (`IFilesSettingsService`)

Singleton owning `module_files_settings`. Exposes `getSettings()` and `updateSettings()`, seeding defaults on first call. `FileService.upload()` reads policy from this service on every upload so admins can change limits at runtime without restarting the backend.

### IStorageProvider / LocalStorageProvider

Thin write/read/delete adapter. `LocalStorageProvider` joins the relative path supplied by `FileService` to the storage root (`/public/uploads/`), creates parent directories, and rejects path traversal attempts. Path layout policy lives in `FileService`, not here — the provider only handles bytes.

Adding S3 or Cloudflare R2 means subclassing `StorageProvider` and swapping the provider construction in `FilesModule.init()`. Neither `FileService` nor any consumer of `IFileService` changes.

### FilesController

Admin REST API at `/api/admin/files`:

- `GET /` — list files; defaults to cross-source. `?source=all` is explicit cross-source; `?source=<kind>:<id>` scopes to one source; MIME prefix filter via `?mimeType=`
- `GET /sources` — distinct `(kind, id)` pairs in the inventory (powers the source dropdown)
- `POST /` — upload a file from the admin Files page; tagged `{ kind: 'module', id: 'files' }`. Legacy admin attachments tagged `module:pages` (migrated by `module:pages:004_files_inventory`) keep their tag and remain reachable via the source filter
- `DELETE /:id` — remove an inventory row and its bytes
- `GET /settings` — current upload policy
- `PATCH /settings` — partial update of upload policy

The controller is a thin status mapper: `FileSizeExceededError` → 413, `FileValidationError` → 400, anything else → 500.

## Database Schema

### `module_pages_files` (inventory)

```typescript
interface IFileDocument {
    _id: ObjectId;
    id: string;                       // Public UUID handle
    source: { kind: 'core' | 'module' | 'plugin'; id: string };
    originalName: string;
    storedName: string;               // UUID-stem, attacker-input-immune
    mimeType: string;
    sizeBytes: number;
    path: string;                     // Storage handle (opaque)
    uploadedBy: string | null;
    uploadedAt: Date;
}
```

Indexes (created by `module:pages:004_files_inventory`): `id` (unique), `(source.kind, source.id, uploadedAt desc)`, `uploadedAt desc`.

### `module_files_settings` (policy singleton)

```typescript
interface IFilesSettingsDocument {
    _id: ObjectId;
    maxFileSize: number;
    allowedFileExtensions: string[];
    filenameSanitizationPattern: string;
    storageProvider: 'local' | 's3' | 'cloudflare';
    updatedAt: Date;
}
```

Seeded by migration `module:files:001_files_settings` from the historical `page_settings` document; defaults applied on fresh installs.

## Consuming the Inventory

Modules and plugins that need to persist or read files **must** consume `IFileService` from the service registry — direct import of `FileService` or `IStorageProvider` from this module is internal-only.

```typescript
// Plugin init — late-binding via watch() so a plugin survives module
// re-registration during runtime enable/disable.
const unwatch = context.services.watch<IFileService>('files', {
    onAvailable: (files) => myService.setFiles(files),
    onUnavailable: () => myService.setFiles(null)
});

// Upload bytes
const record = await files.upload(buffer, originalName, mimeType, {
    source: { kind: 'plugin', id: myManifest.id }
});

// Render in browser
<img src={record.url} alt={record.originalName} />

// Delete
await files.delete(record.id);
```

| Need | Use |
|------|-----|
| Upload bytes | `IFileService.upload(buffer, name, mime, { source })` |
| Read bytes | `IFileService.read(id)` |
| Render in browser | `record.url` from `IFileRecord` |
| Delete | `IFileService.delete(id)` |
| List own outputs | `IFileService.list({ source: { kind, id } })` |
| Map upload errors | `instanceof FileSizeExceededError` → 413, `instanceof FileValidationError` → 400 |

## Migration History

- `module:pages:004_files_inventory` — created the unified `module_pages_files` collection from the legacy `page_files`, added UUID `id` and `source` discriminator. Pre-existed this module.
- `module:files:001_files_settings` — extracted upload policy from `page_settings` into `module_files_settings`.
- `module:pages:005_strip_file_fields_from_page_settings` — sibling migration that removes the now-duplicated fields from `page_settings`.

The collection name `module_pages_files` is intentionally retained. The rows already exist, the migration history references that name, and renaming would cost downtime for no architectural gain.

## Related Documents

- [Backend Modules Overview](../../../../docs/system/modules/modules.md)
- [Module Architecture](../../../../docs/system/modules/modules-architecture.md)
- [Database Access](../../../../docs/system/system-database.md)
- [Pages Module README](../pages/README.md)
