/**
 * Represents an uploaded file tracked by the pages module.
 *
 * Files are stored via configurable storage providers (local filesystem, S3, etc.)
 * and tracked in the database for admin management and usage tracking.
 */
export interface IPageFile {
    /**
     * Unique MongoDB identifier for the file record.
     */
    _id?: string;

    /**
     * Original filename provided by the user during upload.
     * Preserved for display purposes but not used for storage.
     */
    originalName: string;

    /**
     * Sanitized filename used for storage.
     * Follows naming rules from settings (lowercase, hyphens, no special characters).
     */
    storedName: string;

    /**
     * MIME type of the uploaded file (e.g., "image/png", "image/jpeg").
     * Used for validation against allowed types in settings.
     */
    mimeType: string;

    /**
     * File size in bytes.
     * Validated against maximum size limit in settings during upload.
     */
    size: number;

    /**
     * Relative path where the file can be accessed by users.
     * Example: "/uploads/25/10/image-name.png"
     * Used for generating markdown syntax and serving files.
     */
    path: string;

    /**
     * User ID who uploaded the file.
     * Currently always null (admin uploads), reserved for future multi-user support.
     */
    uploadedBy: string | null;

    /**
     * Timestamp when the file was uploaded.
     */
    uploadedAt: Date;
}
