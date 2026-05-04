/**
 * Represents an uploaded file as surfaced by the Pages module's admin UI.
 *
 * The pages module no longer owns its own files collection — it delegates to
 * the unified `IFileService` published on the service registry as `'files'`.
 * `IPageFile` is the legacy adapter shape the admin UI consumes; new code
 * should prefer `IFileRecord` directly.
 */
export interface IPageFile {
    /**
     * Unified file inventory id (UUID issued by `IFileService` at upload time).
     * Pass this back to the admin file routes (e.g. `DELETE /api/admin/pages/files/:id`)
     * to reference the file. Despite the legacy field name, this is *not* a
     * MongoDB `ObjectId` — it is the same UUID that `IFileRecord.id` carries.
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
     * URL-relative path where the file can be accessed by users. Used for
     * generating markdown syntax and serving files. Path layout depends on
     * the upload era: new uploads land under the source-namespaced layout
     * (`/uploads/module/pages/YY/MM/<uuid>.<ext>`) while files migrated from
     * the legacy `page_files` collection retain their original
     * `/uploads/YY/MM/<filename>` paths. Treat as opaque — derive UI URLs
     * from this field directly rather than reconstructing the path.
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
