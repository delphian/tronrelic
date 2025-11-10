/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { PageService } from '../services/page.service.js';
import type { ICacheService, IStorageProvider } from '@tronrelic/types';
import { ObjectId } from 'mongodb';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';

/**
 * Mock CacheService for testing Redis operations.
 */
class MockCacheService implements ICacheService {
    private cache = new Map<string, { value: any; ttl?: number }>();

    async get<T = any>(key: string): Promise<T | null> {
        const entry = this.cache.get(key);
        return entry ? entry.value : null;
    }

    async set<T = any>(key: string, value: T, ttl?: number): Promise<void> {
        this.cache.set(key, { value, ttl });
    }

    async del(key: string): Promise<number> {
        const deleted = this.cache.delete(key);
        return deleted ? 1 : 0;
    }

    async invalidate(tag: string): Promise<void> {
        // No-op for testing
    }

    async keys(pattern: string): Promise<string[]> {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return Array.from(this.cache.keys()).filter(k => regex.test(k));
    }

    clear(): void {
        this.cache.clear();
    }
}

/**
 * Mock StorageProvider for testing file operations.
 */
class MockStorageProvider implements IStorageProvider {
    private files = new Map<string, Buffer>();

    async upload(file: Buffer, filename: string, mimeType: string): Promise<string> {
        const path = `/uploads/test/${filename}`;
        this.files.set(path, file);
        return path;
    }

    async delete(path: string): Promise<boolean> {
        const existed = this.files.has(path);
        if (existed) {
            this.files.delete(path);
        }
        return existed;
    }

    getUrl(path: string): string {
        return path;
    }

    clear(): void {
        this.files.clear();
    }
}


/**
 * Mock logger for testing log output.
 */
const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLogger)
} as any;

describe('PageService', () => {
    let pageService: PageService;
    let mockDatabase: ReturnType<typeof createMockDatabaseService>;
    let mockCache: MockCacheService;
    let mockStorage: MockStorageProvider;

    beforeEach(() => {
        vi.clearAllMocks();
        mockDatabase = createMockDatabaseService();
        mockCache = new MockCacheService();
        mockStorage = new MockStorageProvider();

        // Reset singleton and inject mock dependencies
        (PageService as any).instance = undefined;
        PageService.setDependencies(mockDatabase, mockStorage, mockCache, mockLogger);
        pageService = PageService.getInstance();
    });

    afterEach(() => {
        // Reset singleton after each test
        (PageService as any).instance = undefined;
        mockDatabase.clear();
        mockCache.clear();
        mockStorage.clear();
    });

    // ============================================================================
    // Page Management Tests
    // ============================================================================

    describe('createPage', () => {
        it('should create a page with frontmatter', async () => {
            const content = `---
title: "Test Page"
description: "A test page"
keywords: ["test", "page"]
published: true
---
# Test Page Content

This is a test page.`;

            const page = await pageService.createPage(content);

            expect(page.title).toBe('Test Page');
            expect(page.slug).toBe('/test-page');
            expect(page.description).toBe('A test page');
            expect(page.keywords).toEqual(['test', 'page']);
            expect(page.published).toBe(true);
            expect(page.content).toBe(content);
            expect(page._id).toBeDefined();
        });

        it('should generate slug from title if not provided in frontmatter', async () => {
            const content = `---
title: "My Amazing Page"
---
Content here`;

            const page = await pageService.createPage(content);

            expect(page.slug).toBe('/my-amazing-page');
        });

        it('should use slug from frontmatter if provided', async () => {
            const content = `---
title: "Test Page"
slug: "/custom-slug"
---
Content here`;

            const page = await pageService.createPage(content);

            expect(page.slug).toBe('/custom-slug');
        });

        it('should throw error if title is missing from frontmatter', async () => {
            const content = `---
description: "No title"
---
Content here`;

            await expect(pageService.createPage(content)).rejects.toThrow(
                'Frontmatter must include a title field'
            );
        });

        it('should throw error if slug already exists', async () => {
            const content1 = `---
title: "Page One"
slug: "/duplicate"
---
Content 1`;

            const content2 = `---
title: "Page Two"
slug: "/duplicate"
---
Content 2`;

            await pageService.createPage(content1);

            await expect(pageService.createPage(content2)).rejects.toThrow(
                'A page with slug "/duplicate" already exists'
            );
        });

        it('should throw error if slug is blacklisted', async () => {
            // First, set up blacklisted routes in settings
            const settingsCollection = mockDatabase.getCollection('page_settings');
            await settingsCollection.insertOne({
                _id: new ObjectId(),
                blacklistedRoutes: ['^/api/.*', '^/system/.*'],
                maxFileSize: 10485760,
                allowedFileExtensions: ['.jpg', '.png', '.pdf'],
                filenameSanitizationPattern: '[^a-z0-9-.]',
                storageProvider: 'local',
                updatedAt: new Date()
            });

            const content = `---
title: "API Page"
slug: "/api/forbidden"
---
Content here`;

            await expect(pageService.createPage(content)).rejects.toThrow(
                'Slug "/api/forbidden" conflicts with a blacklisted route pattern'
            );
        });
    });

    describe('updatePage', () => {
        it('should update an existing page', async () => {
            const createContent = `---
title: "Original Title"
---
Original content`;

            const page = await pageService.createPage(createContent);

            const updateContent = `---
title: "Updated Title"
description: "Updated description"
---
Updated content`;

            const updated = await pageService.updatePage(page._id!, updateContent);

            expect(updated.title).toBe('Updated Title');
            expect(updated.description).toBe('Updated description');
            expect(updated.content).toBe(updateContent);
        });

        it('should allow changing slug during update', async () => {
            const createContent = `---
title: "Original"
slug: "/original"
---
Content`;

            const page = await pageService.createPage(createContent);

            const updateContent = `---
title: "Updated"
slug: "/new-slug"
---
Content`;

            const updated = await pageService.updatePage(page._id!, updateContent);

            expect(updated.slug).toBe('/new-slug');
        });

        it('should throw error if page not found', async () => {
            const fakeId = new ObjectId().toString();
            const content = `---
title: "Test"
---
Content`;

            await expect(pageService.updatePage(fakeId, content)).rejects.toThrow(
                `Page with ID ${fakeId} not found`
            );
        });

        it('should invalidate cache when slug changes', async () => {
            const createContent = `---
title: "Original"
slug: "/original"
---
Content`;

            const page = await pageService.createPage(createContent);

            // Cache the page
            await mockCache.set('page:html:/original', '<h1>Original</h1>');

            const updateContent = `---
title: "Updated"
slug: "/updated"
---
Content`;

            await pageService.updatePage(page._id!, updateContent);

            // Old cache should be cleared
            const cachedOld = await mockCache.get('page:html:/original');
            expect(cachedOld).toBeNull();
        });
    });

    describe('getPageById', () => {
        it('should retrieve a page by ID', async () => {
            const content = `---
title: "Test Page"
---
Content`;

            const created = await pageService.createPage(content);
            const retrieved = await pageService.getPageById(created._id!);

            expect(retrieved).toBeDefined();
            expect(retrieved!._id).toBe(created._id);
            expect(retrieved!.title).toBe('Test Page');
        });

        it('should return null if page not found', async () => {
            const fakeId = new ObjectId().toString();
            const retrieved = await pageService.getPageById(fakeId);

            expect(retrieved).toBeNull();
        });
    });

    describe('getPageBySlug', () => {
        it('should retrieve a page by slug', async () => {
            const content = `---
title: "Test Page"
slug: "/test-slug"
---
Content`;

            await pageService.createPage(content);
            const retrieved = await pageService.getPageBySlug('/test-slug');

            expect(retrieved).toBeDefined();
            expect(retrieved!.slug).toBe('/test-slug');
            expect(retrieved!.title).toBe('Test Page');
        });

        it('should return null if slug not found', async () => {
            const retrieved = await pageService.getPageBySlug('/nonexistent');

            expect(retrieved).toBeNull();
        });
    });

    describe('listPages', () => {
        beforeEach(async () => {
            // Create test pages
            await pageService.createPage(`---
title: "Published Page 1"
published: true
---
Content 1`);

            await pageService.createPage(`---
title: "Draft Page 1"
published: false
---
Content 2`);

            await pageService.createPage(`---
title: "Published Page 2"
published: true
---
Content 3`);
        });

        it('should list all pages without filters', async () => {
            const pages = await pageService.listPages();

            expect(pages).toHaveLength(3);
        });

        it('should filter pages by published status', async () => {
            const published = await pageService.listPages({ published: true });
            const drafts = await pageService.listPages({ published: false });

            expect(published).toHaveLength(2);
            expect(drafts).toHaveLength(1);
        });

        it('should support pagination', async () => {
            const firstPage = await pageService.listPages({ limit: 2, skip: 0 });
            const secondPage = await pageService.listPages({ limit: 2, skip: 2 });

            expect(firstPage).toHaveLength(2);
            expect(secondPage).toHaveLength(1);
        });
    });

    describe('deletePage', () => {
        it('should delete a page by ID', async () => {
            const content = `---
title: "To Delete"
---
Content`;

            const page = await pageService.createPage(content);
            await pageService.deletePage(page._id!);

            const retrieved = await pageService.getPageById(page._id!);
            expect(retrieved).toBeNull();
        });

        it('should throw error if page not found', async () => {
            const fakeId = new ObjectId().toString();

            await expect(pageService.deletePage(fakeId)).rejects.toThrow(
                `Page with ID ${fakeId} not found`
            );
        });

        it('should invalidate cache when page deleted', async () => {
            const content = `---
title: "To Delete"
slug: "/to-delete"
---
Content`;

            const page = await pageService.createPage(content);
            await mockCache.set('page:html:/to-delete', '<h1>Content</h1>');

            await pageService.deletePage(page._id!);

            const cached = await mockCache.get('page:html:/to-delete');
            expect(cached).toBeNull();
        });
    });

    describe('getPageStats', () => {
        it('should return correct statistics', async () => {
            await pageService.createPage(`---
title: "Published"
published: true
---
Content`);

            await pageService.createPage(`---
title: "Draft 1"
published: false
---
Content`);

            await pageService.createPage(`---
title: "Draft 2"
published: false
---
Content`);

            const stats = await pageService.getPageStats();

            expect(stats.total).toBe(3);
            expect(stats.published).toBe(1);
            expect(stats.drafts).toBe(2);
        });
    });

    // ============================================================================
    // Markdown Rendering Tests
    // ============================================================================

    describe('renderPageHtml', () => {
        it('should render page content to HTML', async () => {
            const content = `---
title: "Test"
slug: "/test"
---
# Hello World

This is **bold** text.`;

            const page = await pageService.createPage(content);
            const html = await pageService.renderPageHtml(page);

            expect(html).toContain('<h1>Hello World</h1>');
            expect(html).toContain('<strong>bold</strong>');
        });

        it('should cache rendered HTML', async () => {
            const content = `---
title: "Test"
slug: "/test"
---
# Content`;

            const page = await pageService.createPage(content);

            // First render should cache
            await pageService.renderPageHtml(page);

            // Check cache was populated
            const cached = await mockCache.get('page:html:/test');
            expect(cached).toBeDefined();
            expect(cached).toContain('<h1>Content</h1>');
        });

        it('should use cached HTML on subsequent renders', async () => {
            const content = `---
title: "Test"
slug: "/test"
---
# Content`;

            const page = await pageService.createPage(content);

            // Cache some HTML manually
            const cachedHtml = '<h1>Cached Content</h1>';
            await mockCache.set('page:html:/test', cachedHtml);

            const html = await pageService.renderPageHtml(page);
            expect(html).toBe(cachedHtml);
        });
    });

    // ============================================================================
    // File Management Tests
    // ============================================================================

    describe('uploadFile', () => {
        it('should upload a file successfully', async () => {
            const buffer = Buffer.from('test file content');
            const file = await pageService.uploadFile(buffer, 'test-image.png', 'image/png');

            expect(file.originalName).toBe('test-image.png');
            expect(file.mimeType).toBe('image/png');
            expect(file.size).toBe(buffer.length);
            expect(file.path).toBeDefined();
        });

        it('should reject files that exceed max size', async () => {
            // Set up settings with small max size
            const settingsCollection = mockDatabase.getCollection('page_settings');
            await settingsCollection.insertOne({
                _id: new ObjectId(),
                blacklistedRoutes: [],
                maxFileSize: 100, // 100 bytes
                allowedFileExtensions: ['.jpg', '.png'],
                filenameSanitizationPattern: '[^a-z0-9-.]',
                storageProvider: 'local',
                updatedAt: new Date()
            });

            const buffer = Buffer.from('a'.repeat(200)); // 200 bytes

            await expect(
                pageService.uploadFile(buffer, 'large.png', 'image/png')
            ).rejects.toThrow('File size (200 bytes) exceeds maximum allowed (100 bytes)');
        });

        it('should reject files with disallowed extensions', async () => {
            const settingsCollection = mockDatabase.getCollection('page_settings');
            await settingsCollection.insertOne({
                _id: new ObjectId(),
                blacklistedRoutes: [],
                maxFileSize: 10485760,
                allowedFileExtensions: ['.jpg', '.png'],
                filenameSanitizationPattern: '[^a-z0-9-.]',
                storageProvider: 'local',
                updatedAt: new Date()
            });

            const buffer = Buffer.from('test');

            await expect(
                pageService.uploadFile(buffer, 'test.exe', 'application/x-msdownload')
            ).rejects.toThrow('File extension ".exe" is not allowed');
        });

        it('should sanitize filenames', async () => {
            const buffer = Buffer.from('test');
            const file = await pageService.uploadFile(buffer, 'My Test File!@#$.png', 'image/png');

            expect(file.storedName).toBe('my-test-file.png');
        });

        it('should collapse multiple spaces and hyphens', async () => {
            const buffer = Buffer.from('test');
            const file = await pageService.uploadFile(buffer, 'My    Test---File.png', 'image/png');

            expect(file.storedName).toBe('my-test-file.png');
        });

        it('should trim leading and trailing hyphens', async () => {
            const buffer = Buffer.from('test');
            const file = await pageService.uploadFile(buffer, '---test-file---.png', 'image/png');

            expect(file.storedName).toBe('test-file.png');
        });

        it('should handle uppercase extension', async () => {
            const buffer = Buffer.from('test');
            const file = await pageService.uploadFile(buffer, 'TestFile.PNG', 'image/png');

            expect(file.storedName).toBe('testfile.png');
        });

        it('should remove unicode characters', async () => {
            const buffer = Buffer.from('test');
            const file = await pageService.uploadFile(buffer, 'café-résumé.pdf', 'application/pdf');

            // Pattern [^a-z0-9-.] removes accented chars, replaced with hyphens, then collapsed
            expect(file.storedName).toBe('caf-r-sum.pdf');
        });
    });

    describe('listFiles', () => {
        it('should list uploaded files', async () => {
            const buffer = Buffer.from('test');
            await pageService.uploadFile(buffer, 'file1.png', 'image/png');
            await pageService.uploadFile(buffer, 'file2.jpg', 'image/jpeg');

            const files = await pageService.listFiles();

            expect(files).toHaveLength(2);
        });

        it('should filter files by MIME type', async () => {
            const buffer = Buffer.from('test');
            await pageService.uploadFile(buffer, 'image.png', 'image/png');
            await pageService.uploadFile(buffer, 'doc.pdf', 'application/pdf');

            const images = await pageService.listFiles({ mimeType: 'image/' });

            expect(images).toHaveLength(1);
            expect(images[0].mimeType).toContain('image/');
        });
    });

    describe('deleteFile', () => {
        it('should delete a file', async () => {
            const buffer = Buffer.from('test');
            const file = await pageService.uploadFile(buffer, 'test.png', 'image/png');

            await pageService.deleteFile(file._id!);

            const files = await pageService.listFiles();
            expect(files).toHaveLength(0);
        });

        it('should throw error if file not found', async () => {
            const fakeId = new ObjectId().toString();

            await expect(pageService.deleteFile(fakeId)).rejects.toThrow(
                `File with ID ${fakeId} not found`
            );
        });
    });

    // ============================================================================
    // Settings Management Tests
    // ============================================================================

    describe('getSettings', () => {
        it('should return default settings if none exist', async () => {
            const settings = await pageService.getSettings();

            expect(settings).toBeDefined();
            expect(settings.blacklistedRoutes).toBeDefined();
            expect(settings.maxFileSize).toBeGreaterThan(0);
            expect(settings.allowedFileExtensions).toContain('.jpg');
        });

        it('should return existing settings from database', async () => {
            const settingsCollection = mockDatabase.getCollection('page_settings');
            await settingsCollection.insertOne({
                _id: new ObjectId(),
                blacklistedRoutes: ['^/custom/.*'],
                maxFileSize: 5000000,
                allowedFileExtensions: ['.jpg'],
                filenameSanitizationPattern: '[^a-z0-9-.]',
                storageProvider: 'local',
                updatedAt: new Date()
            });

            const settings = await pageService.getSettings();

            expect(settings.blacklistedRoutes).toEqual(['^/custom/.*']);
            expect(settings.maxFileSize).toBe(5000000);
        });
    });

    describe('updateSettings', () => {
        it('should update settings', async () => {
            const updates = {
                maxFileSize: 20000000,
                allowedFileExtensions: ['.jpg', '.png', '.gif']
            };

            const settings = await pageService.updateSettings(updates);

            expect(settings.maxFileSize).toBe(20000000);
            expect(settings.allowedFileExtensions).toEqual(['.jpg', '.png', '.gif']);
        });

        it('should reject invalid max file size', async () => {
            await expect(
                pageService.updateSettings({ maxFileSize: -1 })
            ).rejects.toThrow('Maximum file size must be at least 1 byte');
        });
    });

    // ============================================================================
    // Slug Utilities Tests
    // ============================================================================

    describe('sanitizeSlug', () => {
        it('should convert title to valid slug', () => {
            expect(pageService.sanitizeSlug('My Test Page')).toBe('/my-test-page');
            expect(pageService.sanitizeSlug('Hello World!')).toBe('/hello-world');
            expect(pageService.sanitizeSlug('Multiple   Spaces')).toBe('/multiple-spaces');
        });

        it('should ensure slug starts with forward slash', () => {
            expect(pageService.sanitizeSlug('no-slash')).toBe('/no-slash');
            expect(pageService.sanitizeSlug('/has-slash')).toBe('/has-slash');
        });

        it('should remove special characters', () => {
            expect(pageService.sanitizeSlug('test@#$%page')).toBe('/testpage');
        });

        it('should collapse multiple hyphens', () => {
            expect(pageService.sanitizeSlug('test---page')).toBe('/test-page');
        });
    });

    describe('isSlugBlacklisted', () => {
        beforeEach(async () => {
            const settingsCollection = mockDatabase.getCollection('page_settings');
            await settingsCollection.insertOne({
                _id: new ObjectId(),
                blacklistedRoutes: ['^/api/.*', '^/system/.*', '^/admin/.*'],
                maxFileSize: 10485760,
                allowedFileExtensions: ['.jpg', '.png'],
                filenameSanitizationPattern: '[^a-z0-9-.]',
                storageProvider: 'local',
                updatedAt: new Date()
            });
        });

        it('should detect blacklisted slugs', async () => {
            expect(await pageService.isSlugBlacklisted('/api/test')).toBe(true);
            expect(await pageService.isSlugBlacklisted('/system/pages')).toBe(true);
            expect(await pageService.isSlugBlacklisted('/admin/users')).toBe(true);
        });

        it('should allow non-blacklisted slugs', async () => {
            expect(await pageService.isSlugBlacklisted('/blog/my-post')).toBe(false);
            expect(await pageService.isSlugBlacklisted('/about')).toBe(false);
        });
    });

    // ============================================================================
    // Redirect System Tests
    // ============================================================================

    describe('findPageByOldSlug', () => {
        it('should find page by old slug', async () => {
            const content = `---
title: "Test Page"
slug: "/current-url"
oldSlugs: ["/old-url", "/another-old-url"]
---
Content`;

            await pageService.createPage(content);

            const foundPage = await pageService.findPageByOldSlug('/old-url');

            expect(foundPage).toBeDefined();
            expect(foundPage?.slug).toBe('/current-url');
            expect(foundPage?.oldSlugs).toContain('/old-url');
        });

        it('should return null if old slug not found', async () => {
            const content = `---
title: "Test Page"
slug: "/current-url"
oldSlugs: ["/old-url"]
---
Content`;

            await pageService.createPage(content);

            const foundPage = await pageService.findPageByOldSlug('/nonexistent');

            expect(foundPage).toBeNull();
        });

        it('should find page with multiple old slugs', async () => {
            const content = `---
title: "Test Page"
slug: "/current"
oldSlugs: ["/v1", "/v2", "/v3"]
---
Content`;

            await pageService.createPage(content);

            const page1 = await pageService.findPageByOldSlug('/v1');
            const page2 = await pageService.findPageByOldSlug('/v2');
            const page3 = await pageService.findPageByOldSlug('/v3');

            expect(page1?.slug).toBe('/current');
            expect(page2?.slug).toBe('/current');
            expect(page3?.slug).toBe('/current');
        });
    });

    describe('oldSlugs conflict validation', () => {
        it('should prevent creating page with slug that exists in another page\'s oldSlugs', async () => {
            const content1 = `---
title: "Page One"
slug: "/current"
oldSlugs: ["/old-about"]
---
Content`;

            await pageService.createPage(content1);

            const content2 = `---
title: "Page Two"
slug: "/old-about"
---
Content`;

            await expect(pageService.createPage(content2)).rejects.toThrow(
                'Slug "/old-about" conflicts with redirect from page "Page One"'
            );
        });

        it('should prevent oldSlug that conflicts with existing page slug', async () => {
            const content1 = `---
title: "Page One"
slug: "/existing"
---
Content`;

            await pageService.createPage(content1);

            const content2 = `---
title: "Page Two"
slug: "/new"
oldSlugs: ["/existing"]
---
Content`;

            await expect(pageService.createPage(content2)).rejects.toThrow(
                'Old slug "/existing" conflicts with existing page "Page One"'
            );
        });

        it('should prevent updating slug to value in another page\'s oldSlugs', async () => {
            const content1 = `---
title: "Page One"
slug: "/current"
oldSlugs: ["/old-url"]
---
Content`;

            const content2 = `---
title: "Page Two"
slug: "/page-two"
---
Content`;

            await pageService.createPage(content1);
            const page2 = await pageService.createPage(content2);

            const updateContent = `---
title: "Page Two"
slug: "/old-url"
---
Updated content`;

            await expect(pageService.updatePage(page2._id!, updateContent)).rejects.toThrow(
                'Slug "/old-url" conflicts with redirect from page "Page One"'
            );
        });

        it('should prevent creating page with oldSlug that exists in another page\'s oldSlugs array', async () => {
            const content1 = `---
title: "Page One"
slug: "/current"
oldSlugs: ["/shared-old-slug"]
---
Content`;

            await pageService.createPage(content1);

            const content2 = `---
title: "Page Two"
slug: "/new-page"
oldSlugs: ["/shared-old-slug"]
---
Content`;

            await expect(pageService.createPage(content2)).rejects.toThrow(
                'Old slug "/shared-old-slug" conflicts with redirect from page "Page One"'
            );
        });

        it('should prevent updating oldSlugs to include value in another page\'s oldSlugs array', async () => {
            const content1 = `---
title: "Page One"
slug: "/page-one"
oldSlugs: ["/old-shared"]
---
Content`;

            const content2 = `---
title: "Page Two"
slug: "/page-two"
---
Content`;

            await pageService.createPage(content1);
            const page2 = await pageService.createPage(content2);

            const updateContent = `---
title: "Page Two"
slug: "/page-two"
oldSlugs: ["/old-shared"]
---
Updated content`;

            await expect(pageService.updatePage(page2._id!, updateContent)).rejects.toThrow(
                'Old slug "/old-shared" conflicts with redirect from page "Page One"'
            );
        });
    });

    describe('circular reference prevention', () => {
        it('should prevent slug from being in its own oldSlugs array', async () => {
            const content = `---
title: "Test Page"
slug: "/current"
oldSlugs: ["/current"]
---
Content`;

            await expect(pageService.createPage(content)).rejects.toThrow(
                'Cannot set slug to "/current" - this is already in the page\'s redirect history'
            );
        });

        it('should prevent updating slug to value already in oldSlugs', async () => {
            const content = `---
title: "Test Page"
slug: "/current"
oldSlugs: ["/old-v1", "/old-v2"]
---
Content`;

            const page = await pageService.createPage(content);

            const updateContent = `---
title: "Test Page"
slug: "/old-v1"
oldSlugs: ["/old-v1", "/old-v2"]
---
Updated`;

            await expect(pageService.updatePage(page._id!, updateContent)).rejects.toThrow(
                'Cannot set slug to "/old-v1" - this is already in the page\'s redirect history'
            );
        });
    });

    describe('automatic oldSlugs preservation', () => {
        it('should automatically add old slug when slug changes', async () => {
            const initialContent = `---
title: "Test Page"
slug: "/about"
---
Content`;

            const page = await pageService.createPage(initialContent);
            expect(page.oldSlugs).toEqual([]);

            const updatedContent = `---
title: "Test Page"
slug: "/company/about"
---
Updated content`;

            const updatedPage = await pageService.updatePage(page._id!, updatedContent);

            expect(updatedPage.slug).toBe('/company/about');
            expect(updatedPage.oldSlugs).toContain('/about');
        });

        it('should preserve existing oldSlugs when slug changes', async () => {
            const initialContent = `---
title: "Test Page"
slug: "/v1"
oldSlugs: ["/original"]
---
Content`;

            const page = await pageService.createPage(initialContent);

            const updatedContent = `---
title: "Test Page"
slug: "/v2"
oldSlugs: ["/original"]
---
Updated`;

            const updatedPage = await pageService.updatePage(page._id!, updatedContent);

            expect(updatedPage.slug).toBe('/v2');
            expect(updatedPage.oldSlugs).toContain('/original');
            expect(updatedPage.oldSlugs).toContain('/v1');
            expect(updatedPage.oldSlugs.length).toBe(2);
        });

        it('should not duplicate slugs in oldSlugs array', async () => {
            const initialContent = `---
title: "Test Page"
slug: "/about"
---
Content`;

            const page = await pageService.createPage(initialContent);

            // Change to /new
            const update1 = `---
title: "Test Page"
slug: "/new"
---
Content`;

            await pageService.updatePage(page._id!, update1);

            // Change back to /about (which is now in oldSlugs)
            // This should be blocked by circular reference validation
            const update2 = `---
title: "Test Page"
slug: "/about"
oldSlugs: ["/about"]
---
Content`;

            await expect(pageService.updatePage(page._id!, update2)).rejects.toThrow(
                'Cannot set slug to "/about" - this is already in the page\'s redirect history'
            );
        });

        it('should preserve database oldSlugs when frontmatter omits field', async () => {
            const initialContent = `---
title: "Test Page"
slug: "/v1"
oldSlugs: ["/original"]
---
Content`;

            const page = await pageService.createPage(initialContent);

            // Update without oldSlugs in frontmatter
            const updatedContent = `---
title: "Test Page"
slug: "/v2"
---
Updated content`;

            const updatedPage = await pageService.updatePage(page._id!, updatedContent);

            expect(updatedPage.oldSlugs).toContain('/original');
            expect(updatedPage.oldSlugs).toContain('/v1');
        });

        it('should not add to oldSlugs if slug unchanged', async () => {
            const initialContent = `---
title: "Test Page"
slug: "/about"
---
Content`;

            const page = await pageService.createPage(initialContent);

            const updatedContent = `---
title: "Test Page Updated"
slug: "/about"
---
Updated content but same slug`;

            const updatedPage = await pageService.updatePage(page._id!, updatedContent);

            expect(updatedPage.oldSlugs).toEqual([]);
        });
    });

    describe('frontmatter oldSlugs handling', () => {
        it('should use oldSlugs from frontmatter when provided', async () => {
            const content = `---
title: "Test Page"
slug: "/current"
oldSlugs: ["/old-1", "/old-2"]
---
Content`;

            const page = await pageService.createPage(content);

            expect(page.oldSlugs).toEqual(['/old-1', '/old-2']);
        });

        it('should handle empty oldSlugs array in frontmatter', async () => {
            const content = `---
title: "Test Page"
slug: "/current"
oldSlugs: []
---
Content`;

            const page = await pageService.createPage(content);

            expect(page.oldSlugs).toEqual([]);
        });

        it('should handle missing oldSlugs field in frontmatter', async () => {
            const content = `---
title: "Test Page"
slug: "/current"
---
Content`;

            const page = await pageService.createPage(content);

            expect(page.oldSlugs).toEqual([]);
        });

        it('should allow manually adding oldSlugs in frontmatter during update', async () => {
            const initialContent = `---
title: "Test Page"
slug: "/current"
---
Content`;

            const page = await pageService.createPage(initialContent);

            const updatedContent = `---
title: "Test Page"
slug: "/current"
oldSlugs: ["/manual-redirect"]
---
Updated with manual redirect`;

            const updatedPage = await pageService.updatePage(page._id!, updatedContent);

            expect(updatedPage.oldSlugs).toContain('/manual-redirect');
        });
    });
});
