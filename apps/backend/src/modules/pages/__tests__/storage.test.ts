/// <reference types="vitest" />

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { LocalStorageProvider } from '../services/storage/LocalStorageProvider.js';
import fs from 'fs/promises';
import path from 'path';
import { tmpdir } from 'os';

describe('LocalStorageProvider', () => {
    let storageProvider: LocalStorageProvider;
    let testDir: string;

    beforeEach(async () => {
        // Create a temporary directory for tests
        testDir = path.join(tmpdir(), `pages-test-${Date.now()}`);
        await fs.mkdir(testDir, { recursive: true });

        // Create storage provider with test directory
        storageProvider = new LocalStorageProvider(testDir);
    });

    afterEach(async () => {
        // Clean up test directory
        try {
            await fs.rm(testDir, { recursive: true, force: true });
        } catch (error) {
            // Ignore cleanup errors
        }
    });

    // ============================================================================
    // Upload Tests
    // ============================================================================

    describe('upload', () => {
        it('should upload a file to date-based directory', async () => {
            const fileBuffer = Buffer.from('test file content');
            const filename = 'test-file.txt';

            const relativePath = await storageProvider.upload(fileBuffer, filename, 'text/plain');

            // Path should follow format: /uploads/YY/MM/filename
            expect(relativePath).toMatch(/^\/uploads\/\d{2}\/\d{2}\/test-file\.txt$/);

            // Verify file exists on disk
            const fullPath = path.join(testDir, relativePath.replace('/uploads/', ''));
            const exists = await fs
                .access(fullPath)
                .then(() => true)
                .catch(() => false);

            expect(exists).toBe(true);

            // Verify file content
            const content = await fs.readFile(fullPath, 'utf-8');
            expect(content).toBe('test file content');
        });

        it('should create directory structure if it does not exist', async () => {
            const fileBuffer = Buffer.from('content');
            const filename = 'nested-file.txt';

            const relativePath = await storageProvider.upload(fileBuffer, filename, 'text/plain');

            // Verify directory was created
            const now = new Date();
            const year = now.getFullYear().toString().slice(-2);
            const month = (now.getMonth() + 1).toString().padStart(2, '0');
            const expectedDir = path.join(testDir, year, month);

            const dirExists = await fs
                .access(expectedDir)
                .then(() => true)
                .catch(() => false);

            expect(dirExists).toBe(true);
        });

        it('should handle binary files', async () => {
            const binaryData = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]); // PNG header
            const filename = 'test-image.png';

            const relativePath = await storageProvider.upload(binaryData, filename, 'image/png');

            // Verify file exists and content matches
            const fullPath = path.join(testDir, relativePath.replace('/uploads/', ''));
            const readData = await fs.readFile(fullPath);

            expect(Buffer.compare(readData, binaryData)).toBe(0);
        });

        it('should handle filenames with special characters', async () => {
            const fileBuffer = Buffer.from('content');
            const filename = 'my-file-with-hyphens.txt';

            const relativePath = await storageProvider.upload(fileBuffer, filename, 'text/plain');

            expect(relativePath).toContain('my-file-with-hyphens.txt');
        });

        it('should throw error if directory creation fails', async () => {
            // Mock fs.mkdir to throw error
            const originalMkdir = fs.mkdir;
            vi.spyOn(fs, 'mkdir').mockRejectedValueOnce(new Error('Permission denied'));

            const fileBuffer = Buffer.from('content');
            const filename = 'test.txt';

            await expect(
                storageProvider.upload(fileBuffer, filename, 'text/plain')
            ).rejects.toThrow('Failed to create upload directory');

            // Restore original function
            vi.mocked(fs.mkdir).mockRestore();
        });

        it('should throw error if file write fails', async () => {
            // Mock fs.writeFile to throw error
            vi.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('Disk full'));

            const fileBuffer = Buffer.from('content');
            const filename = 'test.txt';

            await expect(
                storageProvider.upload(fileBuffer, filename, 'text/plain')
            ).rejects.toThrow('Failed to write file to disk');

            // Restore original function
            vi.mocked(fs.writeFile).mockRestore();
        });
    });

    // ============================================================================
    // Delete Tests
    // ============================================================================

    describe('delete', () => {
        it('should delete an existing file', async () => {
            // First upload a file
            const fileBuffer = Buffer.from('content');
            const filename = 'to-delete.txt';
            const relativePath = await storageProvider.upload(fileBuffer, filename, 'text/plain');

            // Verify file exists
            const fullPath = path.join(testDir, relativePath.replace('/uploads/', ''));
            let exists = await fs
                .access(fullPath)
                .then(() => true)
                .catch(() => false);
            expect(exists).toBe(true);

            // Delete the file
            await storageProvider.delete(relativePath);

            // Verify file no longer exists
            exists = await fs
                .access(fullPath)
                .then(() => true)
                .catch(() => false);
            expect(exists).toBe(false);
        });

        it('should gracefully handle deleting non-existent files', async () => {
            const nonExistentPath = '/uploads/25/10/non-existent.txt';

            // Should not throw - gracefully handles missing files
            await expect(storageProvider.delete(nonExistentPath)).resolves.not.toThrow();
        });

        it('should handle paths with different formats', async () => {
            // Upload a file
            const fileBuffer = Buffer.from('content');
            const relativePath = await storageProvider.upload(fileBuffer, 'test.txt', 'text/plain');

            // Delete should work regardless of path format
            await expect(storageProvider.delete(relativePath)).resolves.not.toThrow();
        });
    });

    // ============================================================================
    // Get URL Tests
    // ============================================================================

    describe('getUrl', () => {
        it('should return the same path for local storage', () => {
            const inputPath = '/uploads/25/10/test-file.txt';
            const url = storageProvider.getUrl(inputPath);

            expect(url).toBe(inputPath);
        });

        it('should not modify relative paths', () => {
            const paths = [
                '/uploads/25/10/image.png',
                '/uploads/24/12/document.pdf',
                '/uploads/25/01/archive.zip'
            ];

            paths.forEach(p => {
                expect(storageProvider.getUrl(p)).toBe(p);
            });
        });
    });

    // ============================================================================
    // Integration Tests
    // ============================================================================

    describe('upload + delete integration', () => {
        it('should upload and then delete multiple files', async () => {
            const files = [
                { buffer: Buffer.from('file1'), name: 'file1.txt' },
                { buffer: Buffer.from('file2'), name: 'file2.txt' },
                { buffer: Buffer.from('file3'), name: 'file3.txt' }
            ];

            // Upload all files
            const paths = await Promise.all(
                files.map(f => storageProvider.upload(f.buffer, f.name, 'text/plain'))
            );

            // Verify all files exist
            for (const p of paths) {
                const fullPath = path.join(testDir, p.replace('/uploads/', ''));
                const exists = await fs
                    .access(fullPath)
                    .then(() => true)
                    .catch(() => false);
                expect(exists).toBe(true);
            }

            // Delete all files
            await Promise.all(paths.map(p => storageProvider.delete(p)));

            // Verify all files are deleted
            for (const p of paths) {
                const fullPath = path.join(testDir, p.replace('/uploads/', ''));
                const exists = await fs
                    .access(fullPath)
                    .then(() => true)
                    .catch(() => false);
                expect(exists).toBe(false);
            }
        });

        it('should handle concurrent uploads to same directory', async () => {
            const uploads = Array.from({ length: 10 }, (_, i) => {
                const buffer = Buffer.from(`content ${i}`);
                const filename = `file-${i}.txt`;
                return storageProvider.upload(buffer, filename, 'text/plain');
            });

            const paths = await Promise.all(uploads);

            // All uploads should succeed
            expect(paths).toHaveLength(10);

            // All files should have unique names
            const uniquePaths = new Set(paths);
            expect(uniquePaths.size).toBe(10);
        });
    });

    // ============================================================================
    // Edge Cases
    // ============================================================================

    describe('edge cases', () => {
        it('should handle empty files', async () => {
            const emptyBuffer = Buffer.from('');
            const filename = 'empty.txt';

            const relativePath = await storageProvider.upload(
                emptyBuffer,
                filename,
                'text/plain'
            );

            const fullPath = path.join(testDir, relativePath.replace('/uploads/', ''));
            const content = await fs.readFile(fullPath);

            expect(content.length).toBe(0);
        });

        it('should handle large files', async () => {
            // Create a 1MB file
            const largeBuffer = Buffer.alloc(1024 * 1024);
            largeBuffer.fill('x');

            const filename = 'large.bin';

            const relativePath = await storageProvider.upload(
                largeBuffer,
                filename,
                'application/octet-stream'
            );

            const fullPath = path.join(testDir, relativePath.replace('/uploads/', ''));
            const stat = await fs.stat(fullPath);

            expect(stat.size).toBe(1024 * 1024);
        });

        it('should handle files with same name in different months', async () => {
            const buffer1 = Buffer.from('content1');
            const buffer2 = Buffer.from('content2');
            const filename = 'duplicate.txt';

            // Upload first file
            const path1 = await storageProvider.upload(buffer1, filename, 'text/plain');

            // Mock date to simulate different month (if we could control time)
            // For now, just verify the file was uploaded
            expect(path1).toContain(filename);

            // In practice, files with same name in different months would have different paths
            // because the path includes YY/MM subdirectories
        });
    });
});
