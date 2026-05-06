import { ObjectId } from 'mongodb';
import type { IFileSource } from '@/types';

/**
 * MongoDB document shape for the unified file inventory collection
 * (`module_pages_files` — historical name, retained because the collection
 * is already populated from migration `module:pages:004_files_inventory`).
 *
 * Files are referenced externally by the UUID `id` field, never by `_id`
 * or `path`. The internal `_id` exists only because MongoDB requires it.
 */
export interface IFileDocument {
    _id: ObjectId;

    /** Globally unique UUID. Stable for the lifetime of the file. */
    id: string;

    /** Origin namespace. */
    source: IFileSource;

    /** Original filename supplied at upload time. */
    originalName: string;

    /** Sanitized filename actually written to storage. */
    storedName: string;

    /** Recorded MIME type. */
    mimeType: string;

    /** Size of the stored bytes. */
    sizeBytes: number;

    /**
     * Storage-relative path returned by `IStorageProvider.upload()`. Treated
     * as opaque by consumers; only `FileService` and `IStorageProvider` read
     * or write it.
     */
    path: string;

    /** Optional uploader identity (user UUID, plugin id, etc.). */
    uploadedBy: string | null;

    /** Wall-clock timestamp at upload. */
    uploadedAt: Date;
}
