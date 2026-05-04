import path from 'path';
import fs from 'fs/promises';
import { StorageProvider } from './StorageProvider.js';

/**
 * Local filesystem storage provider.
 *
 * Stores files under `/public/uploads/` at the relative path supplied by the
 * caller. Does not invent its own date-based or namespace layout — path policy
 * lives in `FileService` so the inventory rows and the on-disk paths agree.
 *
 * Files served via Express static middleware at `/uploads/*` routes.
 */
export class LocalStorageProvider extends StorageProvider {
    /**
     * Base directory where files are stored.
     * Defaults to `<cwd>/public/uploads` relative to project root.
     */
    private readonly baseDir: string;

    /**
     * URL prefix returned by upload()/getUrl(). Express serves /uploads/*
     * via static middleware, so the URL form mirrors the on-disk subtree.
     */
    private readonly urlPrefix = '/uploads';

    /**
     * @param baseDir - Optional override for base storage directory.
     *                  Defaults to `<cwd>/public/uploads`.
     */
    constructor(baseDir?: string) {
        super();
        this.baseDir = baseDir || path.join(process.cwd(), 'public', 'uploads');
    }

    /**
     * Write bytes to the requested relative path under the storage root.
     *
     * The caller decides the entire layout (typically
     * `<kind>/<sourceId>/YY/MM/<id>.<ext>`); this method does no path
     * mangling beyond joining with the base directory and creating parent
     * dirs. Path traversal is rejected — the resolved absolute path must
     * remain under `baseDir`.
     *
     * @param file - Buffer containing file data
     * @param relativePath - Path under /uploads/ (no leading slash)
     * @param _mimeType - Recorded by the inventory; not used by local FS
     * @returns URL-relative path (e.g. `/uploads/module/pages/26/05/abc.png`)
     */
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

    /**
     * Read previously stored bytes. Returns null on ENOENT so callers can
     * distinguish "missing file" (clean up the inventory row) from "broken
     * filesystem" (escalate the error).
     *
     * Accepts either the URL-form path returned by upload()
     * (`/uploads/module/pages/...`) or the bare relative path.
     */
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

    /**
     * Delete a previously stored file.
     *
     * Returns true on success, false when the file did not exist (so the
     * inventory row can still be removed cleanly). Other errors propagate.
     *
     * Accepts either the URL-form path returned by upload()
     * (`/uploads/module/pages/...`) or the bare relative path.
     */
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

    /**
     * For local storage the URL is the same path Express static serves.
     * Accepts either the URL form or a bare relative path.
     */
    getUrl(storedPath: string): string {
        if (storedPath.startsWith(this.urlPrefix + '/') || storedPath === this.urlPrefix) {
            return storedPath;
        }
        return `${this.urlPrefix}/${this.normalizeRelativePath(storedPath)}`;
    }

    /** Strip a leading `/uploads/` or `/` so we land at a path under baseDir. */
    private normalizeStoredPath(storedPath: string): string {
        if (storedPath.startsWith(this.urlPrefix + '/')) {
            return storedPath.slice(this.urlPrefix.length + 1);
        }
        return this.normalizeRelativePath(storedPath);
    }

    /** Drop any leading slashes so `path.join(base, ...)` does not escape. */
    private normalizeRelativePath(relativePath: string): string {
        return relativePath.replace(/^\/+/, '');
    }

    /**
     * Reject path traversal: the resolved absolute path must remain inside
     * baseDir. Catches `..` segments and absolute-path injections.
     */
    private assertWithinBase(absolutePath: string): void {
        const resolvedBase = path.resolve(this.baseDir) + path.sep;
        const resolvedTarget = path.resolve(absolutePath);
        if (resolvedTarget !== path.resolve(this.baseDir) && !resolvedTarget.startsWith(resolvedBase)) {
            throw new Error('Refusing to operate on path outside the storage root');
        }
    }
}
