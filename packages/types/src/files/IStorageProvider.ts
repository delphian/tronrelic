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
     * Cheap existence check that avoids loading bytes. Used by
     * `FileService.getVariant` to short-circuit cache hits without
     * paying the I/O cost of reading the variant file. Implementations
     * map this to `fs.access` (local), `HEAD` (S3), or equivalent.
     */
    exists(handle: string): Promise<boolean>;

    /**
     * Enumerate handles whose path starts with the supplied prefix.
     * Used by `FileService.delete` to find and remove cached variants
     * derived from the deleted source. Returns an empty array when no
     * matches exist. Order is unspecified.
     */
    listByPrefix(prefix: string): Promise<string[]>;

    /**
     * Resolve the public, browser-safe URL for a previously stored file.
     */
    getUrl(handle: string): string;
}
