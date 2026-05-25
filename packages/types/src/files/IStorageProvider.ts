/**
 * Lightweight metadata for a stored object, returned by
 * `IStorageProvider.stat()`. Maps cleanly onto `fs.stat` on local
 * filesystems and onto a `HEAD` response on S3-compatible backends.
 * Sized as the union of what `IFileVariant` requires today plus the
 * fields most likely to drive cache-control / conditional-GET work
 * tomorrow, so the contract does not need to widen for the first
 * follow-up consumer.
 */
export interface IStorageObjectStat {
    /** Object size in bytes. */
    sizeBytes: number;
    /** Last modification time as reported by the backend. */
    lastModified: Date;
    /**
     * MIME type as recorded by the backend, when available. S3 returns it
     * in the `HEAD` response; local filesystem providers may have to read
     * the inventory row or omit it. Optional so providers without cheap
     * type metadata are not forced to fabricate one.
     */
    mimeType?: string;
}

/**
 * Abstract interface for file storage providers.
 *
 * Storage providers handle file upload, deletion, and URL generation.
 * Implementations can target local filesystem, S3, Cloudflare, or other
 * storage backends. The Files module uses dependency injection to allow
 * switching providers without code changes.
 *
 * Path layout is decided by the consumer (typically `FileService`) and
 * passed to the provider as a relative path under the storage root. Providers
 * do not invent date-based or namespace-based directory schemes — that
 * policy lives in `FileService` so the inventory and on-disk layout stay
 * aligned.
 */
export interface IStorageProvider {
    /**
     * Upload a file to storage.
     *
     * @param file - Buffer containing file data
     * @param relativePath - Storage-relative path the consumer wants (e.g.
     *                       `module/pages/26/05/<uuid>.png`). The provider
     *                       creates any missing parent directories and writes
     *                       to that exact location. Must not include a
     *                       leading slash.
     * @param mimeType - MIME type of the file (e.g., "image/png")
     * @returns Promise resolving to a provider-specific storage handle that
     *          must be passed back into `read()`, `delete()`, and `getUrl()`.
     */
    upload(file: Buffer, relativePath: string, mimeType: string): Promise<string>;

    /**
     * Read bytes for a previously stored file. Returns null when the file
     * does not exist on the backend.
     */
    read(handle: string): Promise<Buffer | null>;

    /**
     * Delete a file from storage. Returns true if the file existed and was
     * deleted, false if already missing.
     */
    delete(handle: string): Promise<boolean>;

    /**
     * Cheapest possible existence check — no metadata, no bytes.
     * Implementations map this to `fs.access` (local), `HEAD` with a
     * discarded body (S3), or equivalent. Prefer `stat()` when the
     * caller will also need size or modification time on a hit, since
     * a single `stat` is always at least as cheap as `exists` + `stat`.
     */
    exists(handle: string): Promise<boolean>;

    /**
     * Fetch object metadata without reading bytes. Returns null when
     * the handle does not resolve, so callers can treat null/non-null
     * as a combined existence + metadata check. Used by
     * `FileService.getVariant` to short-circuit cache hits while still
     * populating `IFileVariant.sizeBytes` from a single I/O call.
     * Implementations map this to `fs.stat` (local), `HEAD` (S3), or
     * equivalent.
     */
    stat(handle: string): Promise<IStorageObjectStat | null>;

    /**
     * Enumerate handles for stored objects whose storage-relative path
     * starts with `prefix`. The prefix follows the same namespace and
     * formatting rules as `upload()`'s `relativePath` argument — no
     * leading slash, forward-slash separated — and providers translate
     * it to whatever native enumeration their handle scheme uses (a
     * directory walk for local filesystems, `ListObjectsV2` with
     * `Prefix` for S3). The returned strings are handles suitable for
     * passing back into `delete()` / `read()` / `getUrl()`, not raw
     * paths. Used by `FileService.delete` to find and remove cached
     * variants derived from the deleted source. Returns an empty array
     * when no matches exist. Order is unspecified.
     */
    listByPrefix(prefix: string): Promise<string[]>;

    /**
     * Resolve the public, browser-safe URL for a previously stored file.
     */
    getUrl(handle: string): string;
}
