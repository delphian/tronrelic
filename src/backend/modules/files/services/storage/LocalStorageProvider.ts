import path from 'path';
import fs from 'fs/promises';
import { StorageProvider } from './StorageProvider.js';

/**
 * Local filesystem storage provider.
 *
 * Stores files under `/public/uploads/` at the relative path supplied by
 * the caller. Path policy lives in `FileService` so the inventory rows
 * and the on-disk paths agree. Files served via Express static middleware
 * at `/uploads/*` routes.
 */
export class LocalStorageProvider extends StorageProvider {
    private readonly baseDir: string;
    private readonly urlPrefix = '/uploads';

    constructor(baseDir?: string) {
        super();
        this.baseDir = baseDir || path.join(process.cwd(), 'public', 'uploads');
    }

    async upload(file: Buffer, relativePath: string, _mimeType: string): Promise<string> {
        const cleaned = this.normalizeRelativePath(relativePath);
        const targetPath = path.join(this.baseDir, cleaned);
        this.assertWithinBase(targetPath);

        try {
            await fs.mkdir(path.dirname(targetPath), { recursive: true });
        } catch (error) {
            throw new Error(
                `Failed to create upload directory: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }

        try {
            await fs.writeFile(targetPath, file);
        } catch (error) {
            throw new Error(
                `Failed to write file to disk: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }

        return `${this.urlPrefix}/${cleaned}`;
    }

    async read(storedPath: string): Promise<Buffer | null> {
        const cleaned = this.normalizeStoredPath(storedPath);
        const filePath = path.join(this.baseDir, cleaned);
        this.assertWithinBase(filePath);

        try {
            return await fs.readFile(filePath);
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                return null;
            }
            throw new Error(
                `Failed to read file: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    async delete(storedPath: string): Promise<boolean> {
        const cleaned = this.normalizeStoredPath(storedPath);
        const filePath = path.join(this.baseDir, cleaned);
        this.assertWithinBase(filePath);

        try {
            await fs.unlink(filePath);
            return true;
        } catch (error) {
            if (error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT') {
                return false;
            }
            throw new Error(
                `Failed to delete file: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
        }
    }

    getUrl(storedPath: string): string {
        if (storedPath.startsWith(this.urlPrefix + '/') || storedPath === this.urlPrefix) {
            return storedPath;
        }
        return `${this.urlPrefix}/${this.normalizeRelativePath(storedPath)}`;
    }

    private normalizeStoredPath(storedPath: string): string {
        if (storedPath.startsWith(this.urlPrefix + '/')) {
            return storedPath.slice(this.urlPrefix.length + 1);
        }
        return this.normalizeRelativePath(storedPath);
    }

    private normalizeRelativePath(relativePath: string): string {
        return relativePath.replace(/^\/+/, '');
    }

    private assertWithinBase(absolutePath: string): void {
        const resolvedBase = path.resolve(this.baseDir) + path.sep;
        const resolvedTarget = path.resolve(absolutePath);
        if (resolvedTarget !== path.resolve(this.baseDir) && !resolvedTarget.startsWith(resolvedBase)) {
            throw new Error('Refusing to operate on path outside the storage root');
        }
    }
}
