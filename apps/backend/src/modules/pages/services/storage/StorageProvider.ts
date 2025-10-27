import type { IStorageProvider } from '@tronrelic/types';

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
     * @param filename - Sanitized filename to use for storage
     * @param mimeType - MIME type of the file (e.g., "image/png")
     * @returns Promise resolving to the relative path where the file can be accessed
     *
     * @throws Error if upload fails (storage full, permissions issue, etc.)
     */
    abstract upload(file: Buffer, filename: string, mimeType: string): Promise<string>;

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
