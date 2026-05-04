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
     *                       leading slash; the provider prepends its own
     *                       URL prefix on `getUrl()` if needed.
     * @param mimeType - MIME type of the file (e.g., "image/png")
     * @returns Promise resolving to the absolute URL-relative path where the
     *          file can be accessed (e.g. `/uploads/module/pages/26/05/<uuid>.png`).
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
     * @param path - Relative path to the file (as returned by upload())
     * @returns Promise resolving to the file bytes, or null if missing
     */
    read(path: string): Promise<Buffer | null>;

    /**
     * Delete a file from storage.
     *
     * Implementations should gracefully handle missing files (return false)
     * rather than throwing errors, to support cleanup of orphaned database records.
     *
     * @param path - Relative path to the file (as returned by upload())
     * @returns Promise resolving to true if file was deleted, false if already missing
     *
     * @throws Error if deletion fails for reasons other than file not found
     *
     * @example
     * const deleted = await provider.delete("/uploads/25/10/image-2025-10.png");
     * // Returns: true if file existed and was deleted, false if already missing
     */
    delete(path: string): Promise<boolean>;

    /**
     * Get the public URL where a file can be accessed.
     *
     * For local storage, this returns the relative path.
     * For cloud storage (S3, Cloudflare), this might return a CDN URL.
     *
     * @param path - Relative path to the file
     * @returns The URL where the file can be accessed by users
     *
     * @example
     * const url = provider.getUrl("/uploads/25/10/image.png");
     * // Local: "/uploads/25/10/image.png"
     * // S3: "https://cdn.example.com/uploads/25/10/image.png"
     */
    getUrl(path: string): string;
}
