import type { IStorageProvider } from '@/types';

/**
 * Abstract base class for file storage providers.
 *
 * Provides common functionality for all storage provider implementations.
 * Concrete implementations must override the abstract methods to handle
 * provider-specific upload, deletion, and URL generation logic.
 *
 * The pages module uses dependency injection to switch between providers
 * based on configuration settings without code changes.
 */
export abstract class StorageProvider implements IStorageProvider {
    /**
     * Upload a file to storage.
     *
     * Concrete implementations handle provider-specific upload logic.
     *
     * @param file - Buffer containing file data
     * @param relativePath - Storage-relative path supplied by the consumer
     *                       (e.g. `module/pages/26/05/<uuid>.png`). Includes
     *                       any namespace prefixing the consumer wants on
     *                       disk. The provider creates intermediate
     *                       directories.
     * @param mimeType - MIME type of the file (e.g., "image/png")
     * @returns Promise resolving to the URL-relative path where the file can
     *          be accessed (e.g. `/uploads/module/pages/26/05/<uuid>.png`).
     *
     * @throws Error if upload fails (storage full, permissions issue, etc.)
     */
    abstract upload(file: Buffer, relativePath: string, mimeType: string): Promise<string>;

    /**
     * Read bytes for a previously stored file.
     *
     * Concrete implementations resolve the path against the backend and
     * return the file bytes. Returns null when the file does not exist;
     * other errors propagate so callers can distinguish "missing" from
     * "broken backend".
     *
     * @param path - Relative path to the file (as returned by upload())
     * @returns Promise resolving to file bytes, or null if missing
     */
    abstract read(path: string): Promise<Buffer | null>;

    /**
     * Delete a file from storage.
     *
     * Concrete implementations handle provider-specific deletion logic.
     * Should gracefully handle missing files by returning false.
     *
     * @param path - Relative path to the file (as returned by upload())
     * @returns Promise resolving to true if file was deleted, false if already missing
     *
     * @throws Error if deletion fails for reasons other than file not found
     */
    abstract delete(path: string): Promise<boolean>;

    /**
     * Get the public URL where a file can be accessed.
     *
     * Concrete implementations may return relative paths (local storage)
     * or absolute URLs (CDN, S3, Cloudflare).
     *
     * @param path - Relative path to the file
     * @returns The URL where the file can be accessed by users
     */
    abstract getUrl(path: string): string;
}
