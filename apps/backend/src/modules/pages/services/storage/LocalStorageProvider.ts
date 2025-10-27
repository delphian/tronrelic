import path from 'path';
import fs from 'fs/promises';
import { StorageProvider } from './StorageProvider.js';

/**
 * Local filesystem storage provider.
 *
 * Stores uploaded files in the /public/uploads/ directory organized by date.
 * Files are accessible via Express static middleware at /uploads/* routes.
 *
 * Directory structure: /public/uploads/YY/MM/filename.ext
 * Example: /public/uploads/25/10/my-image.png
 */
export class LocalStorageProvider extends StorageProvider {
    /**
     * Base directory where files are stored.
     * Defaults to /public/uploads relative to project root.
     */
    private readonly baseDir: string;

    /**
     * Create a local storage provider.
     *
     * @param baseDir - Optional override for base storage directory (default: /public/uploads)
     */
    constructor(baseDir?: string) {
        super();
        this.baseDir = baseDir || path.join(process.cwd(), 'public', 'uploads');
    }

    /**
     * Upload a file to local filesystem.
     *
     * Creates date-based subdirectories (YY/MM) if they don't exist.
     * Writes file buffer to disk with sanitized filename.
     *
     * @param file - Buffer containing file data
     * @param filename - Sanitized filename to use for storage
     * @param mimeType - MIME type of the file (not used for local storage)
     * @returns Promise resolving to relative path where file can be accessed
     *
     * @throws Error if filesystem write fails (permissions, disk full, etc.)
     *
     * @example
     * const path = await provider.upload(buffer, "my-image.png", "image/png");
     * // Returns: "/uploads/25/10/my-image.png"
     */
    async upload(file: Buffer, filename: string, mimeType: string): Promise<string> {
        const now = new Date();
        const year = now.getFullYear().toString().slice(-2); // Last 2 digits
        const month = (now.getMonth() + 1).toString().padStart(2, '0');

        // Create date-based directory structure: /public/uploads/YY/MM/
        const uploadDir = path.join(this.baseDir, year, month);

        try {
            await fs.mkdir(uploadDir, { recursive: true });
        } catch (error) {
            throw new Error(
                `Failed to create upload directory: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }

        // Full filesystem path where file will be stored
        const filePath = path.join(uploadDir, filename);

        try {
            await fs.writeFile(filePath, file);
        } catch (error) {
            throw new Error(
                `Failed to write file to disk: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }

        // Return relative path for database and URL generation
        return `/uploads/${year}/${month}/${filename}`;
    }

    /**
     * Delete a file from local filesystem.
     *
     * Converts relative path to absolute filesystem path and removes the file.
     * Does not delete empty parent directories.
     *
     * Gracefully handles missing files by returning false instead of throwing an error.
     * This allows database records to be cleaned up even when physical files are missing
     * (e.g., due to container restarts, manual deletion, or incomplete uploads).
     *
     * @param relativePath - Relative path to the file (e.g., "/uploads/25/10/image.png")
     * @returns Promise resolving to true if file was deleted, false if already missing
     *
     * @throws Error if file deletion fails for reasons other than file not found
     *
     * @example
     * const deleted = await provider.delete("/uploads/25/10/my-image.png");
     * // Returns: true if file existed and was deleted, false if already missing
     */
    async delete(relativePath: string): Promise<boolean> {
        // Convert relative path to absolute filesystem path
        // relativePath: "/uploads/25/10/image.png"
        // Remove leading "/uploads" and join with baseDir
        const pathWithoutPrefix = relativePath.replace(/^\/uploads\//, '');
        const filePath = path.join(this.baseDir, pathWithoutPrefix);

        try {
            await fs.unlink(filePath);
            return true; // File existed and was successfully deleted
        } catch (error) {
            // Gracefully handle file-not-found errors
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                // File already deleted or never existed - return false but don't throw
                return false;
            }

            // Re-throw other errors (permissions, disk errors, etc.)
            throw new Error(
                `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    /**
     * Get the public URL where a file can be accessed.
     *
     * For local storage, returns the relative path unchanged.
     * Express static middleware serves files at /uploads/* routes.
     *
     * @param path - Relative path to the file
     * @returns The same relative path for browser access
     *
     * @example
     * const url = provider.getUrl("/uploads/25/10/image.png");
     * // Returns: "/uploads/25/10/image.png"
     */
    getUrl(path: string): string {
        return path;
    }
}
