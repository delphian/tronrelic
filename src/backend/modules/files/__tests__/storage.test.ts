/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalStorageProvider } from '../services/storage/LocalStorageProvider.js';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';

/**
 * The storage provider is a thin write/read/delete adapter over the
 * filesystem. Path layout (date-based, namespace-based, etc.) is the
 * caller's responsibility — `FileService` builds those paths and passes
 * them in. These tests exercise the adapter contract: write what we say,
 * read what we wrote, refuse paths that escape the storage root.
 */
describe('LocalStorageProvider', () => {
    let storageProvider: LocalStorageProvider;
    let testDir: string;

    beforeEach(async () => {
        testDir = path.join(tmpdir(), `pages-test-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });
        storageProvider = new LocalStorageProvider(testDir);
    });

    afterEach(async () => {
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch {
            // ignore cleanup errors
        }
    });

    describe('upload', () => {
        it('writes bytes at the requested relative path', async () => {
            const fileBuffer = Buffer.from('test file content');

            const url = await storageProvider.upload(
                fileBuffer,
                'module/pages/26/05/abc.txt',
                'text/plain'
            );

            expect(url).toBe('/uploads/module/pages/26/05/abc.txt');

            const fullPath = path.join(testDir, 'module/pages/26/05/abc.txt');
            const content = await fs.readFile(fullPath, 'utf-8');
            expect(content).toBe('test file content');
        });

        it('creates intermediate directories', async () => {
            const url = await storageProvider.upload(
                Buffer.from('x'),
                'plugin/image-gen/26/05/nested.bin',
                'application/octet-stream'
            );

            expect(url).toBe('/uploads/plugin/image-gen/26/05/nested.bin');
            const dirExists = await fs
                .access(path.join(testDir, 'plugin/image-gen/26/05'))
                .then(() => true)
                .catch(() => false);
            expect(dirExists).toBe(true);
        });

        it('preserves binary content exactly', async () => {
            const binary = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
            const url = await storageProvider.upload(binary, 'module/pages/img.png', 'image/png');

            const readBack = await fs.readFile(path.join(testDir, 'module/pages/img.png'));
            expect(Buffer.compare(readBack, binary)).toBe(0);
            expect(url).toBe('/uploads/module/pages/img.png');
        });

        it('rejects paths that escape the storage root', async () => {
            await expect(
                storageProvider.upload(Buffer.from('x'), '../escape.txt', 'text/plain')
            ).rejects.toThrow(/storage root/i);
        });

        it('reports directory creation failure', async () => {
            vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(new Error('Permission denied'));

            await expect(
                storageProvider.upload(Buffer.from('x'), 'module/pages/x.txt', 'text/plain')
            ).rejects.toThrow('Failed to create upload directory');

            vi.mocked(fs.mkdir).mockRestore();
        });

        it('reports write failure', async () => {
            vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Disk full'));

            await expect(
                storageProvider.upload(Buffer.from('x'), 'module/pages/x.txt', 'text/plain')
            ).rejects.toThrow('Failed to write file to disk');

            vi.mocked(fs.writeFile).mockRestore();
        });
    });

    describe('read', () => {
        it('returns bytes for a previously uploaded file', async () => {
            await storageProvider.upload(Buffer.from('hello'), 'module/pages/r1.txt', 'text/plain');

            const bytes = await storageProvider.read('/uploads/module/pages/r1.txt');
            expect(bytes?.toString('utf-8')).toBe('hello');
        });

        it('accepts the bare relative path too', async () => {
            await storageProvider.upload(Buffer.from('hello'), 'module/pages/r2.txt', 'text/plain');

            const bytes = await storageProvider.read('module/pages/r2.txt');
            expect(bytes?.toString('utf-8')).toBe('hello');
        });

        it('returns null when the file does not exist', async () => {
            const bytes = await storageProvider.read('/uploads/missing/file.txt');
            expect(bytes).toBeNull();
        });

        it('rejects paths that escape the storage root', async () => {
            await expect(storageProvider.read('../etc/passwd')).rejects.toThrow(/storage root/i);
        });
    });

    describe('delete', () => {
        it('removes an existing file and reports true', async () => {
            const url = await storageProvider.upload(
                Buffer.from('x'),
                'module/pages/del.txt',
                'text/plain'
            );

            const removed = await storageProvider.delete(url);
            expect(removed).toBe(true);

            const exists = await fs
                .access(path.join(testDir, 'module/pages/del.txt'))
                .then(() => true)
                .catch(() => false);
            expect(exists).toBe(false);
        });

        it('returns false for missing files (no throw)', async () => {
            const removed = await storageProvider.delete('/uploads/missing/file.txt');
            expect(removed).toBe(false);
        });
    });

    describe('getUrl', () => {
        it('echoes the URL form unchanged', () => {
            expect(storageProvider.getUrl('/uploads/module/pages/x.png')).toBe(
                '/uploads/module/pages/x.png'
            );
        });

        it('prepends /uploads/ to a bare relative path', () => {
            expect(storageProvider.getUrl('module/pages/x.png')).toBe(
                '/uploads/module/pages/x.png'
            );
        });
    });

    describe('upload + delete integration', () => {
        it('round-trips multiple files', async () => {
            const files = [
                { name: 'module/pages/file1.txt', content: 'one' },
                { name: 'module/pages/file2.txt', content: 'two' },
                { name: 'plugin/image-gen/26/05/file3.txt', content: 'three' }
            ];

            const urls = await Promise.all(
                files.map((f) =>
                    storageProvider.upload(Buffer.from(f.content), f.name, 'text/plain')
                )
            );

            for (let i = 0; i < urls.length; i++) {
                const back = await storageProvider.read(urls[i]);
                expect(back?.toString('utf-8')).toBe(files[i].content);
            }

            await Promise.all(urls.map((u) => storageProvider.delete(u)));
            for (const u of urls) {
                expect(await storageProvider.read(u)).toBeNull();
            }
        });
    });
});
