import type { IStorageProvider } from '@/types';

/**
 * Abstract base class for file storage providers.
 *
 * Concrete implementations override the abstract methods to handle
 * provider-specific upload, read, deletion, and URL generation. Path
 * layout is decided by `FileService` (the consumer), not the provider —
 * see `FileService.buildRelativePath()`.
 */
export abstract class StorageProvider implements IStorageProvider {
    abstract upload(file: Buffer, relativePath: string, mimeType: string): Promise<string>;
    abstract read(handle: string): Promise<Buffer | null>;
    abstract delete(handle: string): Promise<boolean>;
    abstract getUrl(handle: string): string;
}
