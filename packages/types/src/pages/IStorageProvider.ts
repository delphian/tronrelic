/**
 * Abstract interface for file storage providers.
 *
 * Storage providers handle file upload, deletion, and URL generation.
 * Implementations can target local filesystem, S3, Cloudflare, or other storage backends.
 * The pages module uses dependency injection to allow switching providers without code changes.
 *
 * Path layout is decided by the consumer (typically `FileService`) and passed
 * to the provider as a relative path under the storage root. Providers do not
 * invent date-based or namespace-based directory schemes — that policy lives
 * in `FileService` so the inventory and on-disk layout stay aligned.
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
     *          must be passed back into `read()`, `delete()`, and `getUrl()`
     *          to operate on the same file. The handle is **not** required
     *          to be a public URL — callers must call `getUrl(handle)` to
     *          obtain a browser-safe address. `LocalStorageProvider` echoes
     *          the URL form (`/uploads/...`) because Express serves it
     *          directly; an S3 provider would return an internal bucket key
     *          and resolve a CDN URL through `getUrl()`.
     *
     * @throws Error if upload fails (storage full, permissions issue, etc.)
     */
    upload(file: Buffer, relativePath: string, mimeType: string): Promise<string>;

    /**
     * Read bytes for a previously stored file.
     *
     * Returns null when the file does not exist on the backend. Errors other
     * than "not found" (permissions, IO failure) propagate as exceptions.
     *
     * @param handle - Storage handle as returned by `upload()`
     * @returns Promise resolving to the file bytes, or null if missing
     */
    read(handle: string): Promise<Buffer | null>;

    /**
     * Delete a file from storage.
     *
     * Implementations should gracefully handle missing files (return false)
     * rather than throwing errors, to support cleanup of orphaned database records.
     *
     * @param handle - Storage handle as returned by `upload()`
     * @returns Promise resolving to true if file was deleted, false if already missing
     *
     * @throws Error if deletion fails for reasons other than file not found
     */
    delete(handle: string): Promise<boolean>;

    /**
     * Resolve the public, browser-safe URL for a previously stored file.
     *
     * For local storage, the handle and the URL coincide (Express serves
     * `/uploads/*` directly). For cloud storage (S3, Cloudflare R2), the
     * handle is an internal bucket key and `getUrl()` returns the CDN URL
     * the browser should fetch.
     *
     * @param handle - Storage handle as returned by `upload()`
     * @returns The URL where the file can be accessed by users
     */
    getUrl(handle: string): string;
}
