import { ObjectId } from 'mongodb';
import type { IFileSource } from '@/types';

/**
 * MongoDB document shape for `module_pages_files`, the unified file inventory
 * owned by the Pages module and exposed to other modules and plugins via
 * `IFileService` on the service registry.
 *
 * Files are referenced externally by the UUID `id` field, never by `_id` or
 * `path`. The internal `_id` exists only because MongoDB requires it; new
 * code should treat `id` as the public handle.
 */
export interface IFileDocument {
    _id: ObjectId;

    /**
     * Globally unique UUID. Stable for the lifetime of the file. This is the
     * value passed across plugin/module boundaries and into AI tool inputs.
     */
    id: string;

    /**
     * Origin namespace. The on-disk path encodes the same `(kind, id)` pair
     * (`/uploads/<kind>/<id>/...`) so operators can reason about disk usage
     * by source without joining against the database.
     */
    source: IFileSource;

    /** Original filename supplied at upload time. */
    originalName: string;

    /** Sanitized filename actually written to storage. */
    storedName: string;

    /** Recorded MIME type. */
    mimeType: string;

    /** Size of the stored bytes. */
    size: number;

    /**
     * Storage-relative path returned by `IStorageProvider.upload()`. Treated
     * as opaque by consumers; only `FileService` and `IStorageProvider`
     * read or write it.
     */
    path: string;

    /** Optional uploader identity (user UUID, plugin id, etc.). */
    uploadedBy: string | null;

    /** Wall-clock timestamp at upload. */
    uploadedAt: Date;
}
