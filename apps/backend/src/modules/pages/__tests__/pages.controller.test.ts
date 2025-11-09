/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PagesController } from '../api/pages.controller.js';
import type { IPageService } from '@tronrelic/types';
import type { Request, Response } from 'express';
import { ObjectId } from 'mongodb';

/**
 * Mock PageService for testing controller endpoints.
 */
class MockPageService implements IPageService {
    createPage = vi.fn();
    updatePage = vi.fn();
    getPageById = vi.fn();
    getPageBySlug = vi.fn();
    findPageByOldSlug = vi.fn();
    listPages = vi.fn();
    deletePage = vi.fn();
    getPageStats = vi.fn();
    renderPageHtml = vi.fn();
    invalidatePageCache = vi.fn();
    previewMarkdown = vi.fn();
    renderPublicPageBySlug = vi.fn();
    uploadFile = vi.fn();
    listFiles = vi.fn();
    deleteFile = vi.fn();
    getSettings = vi.fn();
    updateSettings = vi.fn();
    sanitizeSlug = vi.fn();
    isSlugBlacklisted = vi.fn();
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

/**
 * Helper to create mock Express Request object.
 */
function createMockRequest(overrides: Partial<Request> = {}): Request {
    return {
        params: {},
        query: {},
        body: {},
        file: undefined,
        ...overrides
    } as Request;
}

/**
 * Helper to create mock Express Response object.
 */
function createMockResponse(): Response {
    const res = {
        status: vi.fn().mockReturnThis(),
        json: vi.fn().mockReturnThis(),
        send: vi.fn().mockReturnThis(),
        redirect: vi.fn().mockReturnThis()
    };
    return res as unknown as Response;
}

describe('PagesController', () => {
    let controller: PagesController;
    let mockService: MockPageService;

    beforeEach(() => {
        vi.clearAllMocks();
        mockService = new MockPageService();
        controller = new PagesController(mockService as any, mockLogger);
    });

    // ============================================================================
    // Page Endpoint Tests
    // ============================================================================

    describe('listPages', () => {
        it('should list pages with stats', async () => {
            const mockPages = [
                { _id: '1', title: 'Page 1', slug: '/page-1', published: true },
                { _id: '2', title: 'Page 2', slug: '/page-2', published: false }
            ];
            const mockStats = { total: 2, published: 1, drafts: 1 };

            mockService.listPages.mockResolvedValue(mockPages);
            mockService.getPageStats.mockResolvedValue(mockStats);

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.listPages(req, res);

            expect(res.json).toHaveBeenCalledWith({
                pages: mockPages,
                stats: mockStats
            });
        });

        it('should handle query parameters', async () => {
            mockService.listPages.mockResolvedValue([]);
            mockService.getPageStats.mockResolvedValue({ total: 0, published: 0, drafts: 0 });

            const req = createMockRequest({
                query: {
                    published: 'true',
                    search: 'test',
                    limit: '10',
                    skip: '5'
                }
            });
            const res = createMockResponse();

            await controller.listPages(req, res);

            expect(mockService.listPages).toHaveBeenCalledWith({
                published: true,
                search: 'test',
                limit: 10,
                skip: 5
            });
        });

        it('should handle errors', async () => {
            mockService.listPages.mockRejectedValue(new Error('Database error'));

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.listPages(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to list pages',
                message: 'Database error'
            });
        });
    });

    describe('getPage', () => {
        it('should get a page by ID', async () => {
            const mockPage = { _id: '123', title: 'Test', slug: '/test' };
            mockService.getPageById.mockResolvedValue(mockPage);

            const req = createMockRequest({ params: { id: '123' } });
            const res = createMockResponse();

            await controller.getPage(req, res);

            expect(mockService.getPageById).toHaveBeenCalledWith('123');
            expect(res.json).toHaveBeenCalledWith(mockPage);
        });

        it('should return 404 if page not found', async () => {
            mockService.getPageById.mockResolvedValue(null);

            const req = createMockRequest({ params: { id: '123' } });
            const res = createMockResponse();

            await controller.getPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
        });
    });

    describe('createPage', () => {
        it('should create a new page', async () => {
            const content = '---\ntitle: "Test"\n---\nContent';
            const mockPage = { _id: '123', title: 'Test', slug: '/test', content };

            mockService.createPage.mockResolvedValue(mockPage);

            const req = createMockRequest({ body: { content } });
            const res = createMockResponse();

            await controller.createPage(req, res);

            expect(mockService.createPage).toHaveBeenCalledWith(content);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(mockPage);
        });

        it('should return 400 if content missing', async () => {
            const req = createMockRequest({ body: {} });
            const res = createMockResponse();

            await controller.createPage(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Content is required' });
        });

        it('should handle validation errors', async () => {
            mockService.createPage.mockRejectedValue(new Error('Invalid frontmatter'));

            const req = createMockRequest({ body: { content: 'test' } });
            const res = createMockResponse();

            await controller.createPage(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to create page',
                message: 'Invalid frontmatter'
            });
        });
    });

    describe('updatePage', () => {
        it('should update an existing page', async () => {
            const content = '---\ntitle: "Updated"\n---\nContent';
            const mockPage = { _id: '123', title: 'Updated', slug: '/updated', content };

            mockService.updatePage.mockResolvedValue(mockPage);

            const req = createMockRequest({
                params: { id: '123' },
                body: { content }
            });
            const res = createMockResponse();

            await controller.updatePage(req, res);

            expect(mockService.updatePage).toHaveBeenCalledWith('123', content);
            expect(res.json).toHaveBeenCalledWith(mockPage);
        });

        it('should return 400 if content missing', async () => {
            const req = createMockRequest({
                params: { id: '123' },
                body: {}
            });
            const res = createMockResponse();

            await controller.updatePage(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Content is required' });
        });

        it('should return 404 if page not found', async () => {
            mockService.updatePage.mockRejectedValue(new Error('Page with ID 123 not found'));

            const req = createMockRequest({
                params: { id: '123' },
                body: { content: 'test' }
            });
            const res = createMockResponse();

            await controller.updatePage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    describe('deletePage', () => {
        it('should delete a page', async () => {
            mockService.deletePage.mockResolvedValue(undefined);

            const req = createMockRequest({ params: { id: '123' } });
            const res = createMockResponse();

            await controller.deletePage(req, res);

            expect(mockService.deletePage).toHaveBeenCalledWith('123');
            expect(res.status).toHaveBeenCalledWith(204);
            expect(res.send).toHaveBeenCalled();
        });

        it('should return 404 if page not found', async () => {
            mockService.deletePage.mockRejectedValue(new Error('Page with ID 123 not found'));

            const req = createMockRequest({ params: { id: '123' } });
            const res = createMockResponse();

            await controller.deletePage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    // ============================================================================
    // File Endpoint Tests
    // ============================================================================

    describe('listFiles', () => {
        it('should list uploaded files', async () => {
            const mockFiles = [
                { _id: '1', originalName: 'file1.png', mimeType: 'image/png' },
                { _id: '2', originalName: 'file2.pdf', mimeType: 'application/pdf' }
            ];

            mockService.listFiles.mockResolvedValue(mockFiles);

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.listFiles(req, res);

            expect(res.json).toHaveBeenCalledWith({ files: mockFiles });
        });

        it('should handle query parameters', async () => {
            mockService.listFiles.mockResolvedValue([]);

            const req = createMockRequest({
                query: {
                    mimeType: 'image/',
                    limit: '50',
                    skip: '10'
                }
            });
            const res = createMockResponse();

            await controller.listFiles(req, res);

            expect(mockService.listFiles).toHaveBeenCalledWith({
                mimeType: 'image/',
                limit: 50,
                skip: 10
            });
        });
    });

    describe('uploadFile', () => {
        it('should upload a file', async () => {
            const mockFile = {
                _id: '123',
                originalName: 'test.png',
                storedName: 'test.png',
                mimeType: 'image/png',
                size: 1024,
                path: '/uploads/25/10/test.png'
            };

            mockService.getSettings.mockResolvedValue({
                maxFileSize: 10 * 1024 * 1024,
                allowedMimeTypes: []
            });

            mockService.uploadFile.mockResolvedValue(mockFile);

            const req = createMockRequest({
                file: {
                    buffer: Buffer.from('test'),
                    originalname: 'test.png',
                    mimetype: 'image/png',
                    size: 1024
                } as any
            });
            const res = createMockResponse();

            await controller.uploadFile(req, res);

            expect(mockService.uploadFile).toHaveBeenCalledWith(
                expect.any(Buffer),
                'test.png',
                'image/png'
            );
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(mockFile);
        });

        it('should return 400 if no file provided', async () => {
            const req = createMockRequest({ file: undefined });
            const res = createMockResponse();

            await controller.uploadFile(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'No file provided' });
        });

        it('should reject file exceeding configured size limit', async () => {
            // Mock settings with 10MB limit
            mockService.getSettings.mockResolvedValue({
                maxFileSize: 10 * 1024 * 1024, // 10MB
                allowedMimeTypes: []
            });

            // Create a file larger than 10MB (15MB)
            const largeFileSize = 15 * 1024 * 1024;
            const req = createMockRequest({
                file: {
                    buffer: Buffer.alloc(largeFileSize),
                    originalname: 'large-file.png',
                    mimetype: 'image/png',
                    size: largeFileSize
                } as any
            });
            const res = createMockResponse();

            await controller.uploadFile(req, res);

            // Should return 413 Payload Too Large
            expect(res.status).toHaveBeenCalledWith(413);
            expect(res.json).toHaveBeenCalledWith({
                error: 'File too large',
                message: 'File size 15.00MB exceeds the maximum allowed size of 10.00MB',
                fileSize: largeFileSize,
                maxFileSize: 10 * 1024 * 1024
            });

            // Should NOT call uploadFile service
            expect(mockService.uploadFile).not.toHaveBeenCalled();
        });

        it('should accept file within configured size limit', async () => {
            // Mock settings with 10MB limit
            mockService.getSettings.mockResolvedValue({
                maxFileSize: 10 * 1024 * 1024, // 10MB
                allowedMimeTypes: []
            });

            const mockFile = {
                _id: '123',
                originalName: 'small-file.png',
                storedName: 'small-file.png',
                mimeType: 'image/png',
                size: 5 * 1024 * 1024, // 5MB
                path: '/uploads/25/10/small-file.png'
            };

            mockService.uploadFile.mockResolvedValue(mockFile);

            // Create a file smaller than 10MB (5MB)
            const smallFileSize = 5 * 1024 * 1024;
            const req = createMockRequest({
                file: {
                    buffer: Buffer.alloc(smallFileSize),
                    originalname: 'small-file.png',
                    mimetype: 'image/png',
                    size: smallFileSize
                } as any
            });
            const res = createMockResponse();

            await controller.uploadFile(req, res);

            // Should accept and upload
            expect(mockService.uploadFile).toHaveBeenCalled();
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith(mockFile);
        });

        it('should handle upload errors', async () => {
            mockService.getSettings.mockResolvedValue({
                maxFileSize: 10 * 1024 * 1024,
                allowedMimeTypes: []
            });

            mockService.uploadFile.mockRejectedValue(new Error('Storage error'));

            const req = createMockRequest({
                file: {
                    buffer: Buffer.from('test'),
                    originalname: 'test.png',
                    mimetype: 'image/png',
                    size: 1024
                } as any
            });
            const res = createMockResponse();

            await controller.uploadFile(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to upload file',
                message: 'Storage error'
            });
        });
    });

    describe('deleteFile', () => {
        it('should delete a file', async () => {
            mockService.deleteFile.mockResolvedValue(undefined);

            const req = createMockRequest({ params: { id: '123' } });
            const res = createMockResponse();

            await controller.deleteFile(req, res);

            expect(mockService.deleteFile).toHaveBeenCalledWith('123');
            expect(res.status).toHaveBeenCalledWith(204);
            expect(res.send).toHaveBeenCalled();
        });

        it('should return 404 if file not found', async () => {
            mockService.deleteFile.mockRejectedValue(new Error('File with ID 123 not found'));

            const req = createMockRequest({ params: { id: '123' } });
            const res = createMockResponse();

            await controller.deleteFile(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    // ============================================================================
    // Settings Endpoint Tests
    // ============================================================================

    describe('getSettings', () => {
        it('should get current settings', async () => {
            const mockSettings = {
                blacklistedRoutes: ['^/api/.*'],
                maxFileSize: 10485760,
                allowedFileExtensions: ['.jpg', '.png'],
                filenameSanitizationPattern: '[^a-z0-9-.]',
                storageProvider: 'local'
            };

            mockService.getSettings.mockResolvedValue(mockSettings);

            const req = createMockRequest();
            const res = createMockResponse();

            await controller.getSettings(req, res);

            expect(res.json).toHaveBeenCalledWith(mockSettings);
        });
    });

    describe('updateSettings', () => {
        it('should update settings', async () => {
            const updates = {
                maxFileSize: 20971520,
                allowedFileExtensions: ['.jpg', '.png', '.gif']
            };

            const mockSettings = {
                blacklistedRoutes: ['^/api/.*'],
                maxFileSize: 20971520,
                allowedFileExtensions: ['.jpg', '.png', '.gif'],
                filenameSanitizationPattern: '[^a-z0-9-.]',
                storageProvider: 'local'
            };

            mockService.updateSettings.mockResolvedValue(mockSettings);

            const req = createMockRequest({ body: updates });
            const res = createMockResponse();

            await controller.updateSettings(req, res);

            expect(mockService.updateSettings).toHaveBeenCalledWith(updates);
            expect(res.json).toHaveBeenCalledWith(mockSettings);
        });

        it('should handle validation errors', async () => {
            mockService.updateSettings.mockRejectedValue(
                new Error('Maximum file size must be at least 1 byte')
            );

            const req = createMockRequest({ body: { maxFileSize: -1 } });
            const res = createMockResponse();

            await controller.updateSettings(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    // ============================================================================
    // Public Endpoint Tests
    // ============================================================================

    describe('getPublicPage', () => {
        it('should get a published page by slug', async () => {
            const mockPage = {
                _id: '123',
                title: 'Public Page',
                slug: '/public',
                published: true
            };

            mockService.getPageBySlug.mockResolvedValue(mockPage);

            const req = createMockRequest({ params: { slug: 'public' } });
            const res = createMockResponse();

            await controller.getPublicPage(req, res);

            expect(mockService.getPageBySlug).toHaveBeenCalledWith('/public');
            expect(res.json).toHaveBeenCalledWith({
                page: mockPage,
                requestedSlug: '/public'
            });
        });

        it('should prepend slash to slug if missing', async () => {
            const mockPage = {
                _id: '123',
                title: 'Public Page',
                slug: '/public',
                published: true
            };

            mockService.getPageBySlug.mockResolvedValue(mockPage);

            const req = createMockRequest({ params: { slug: 'public' } });
            const res = createMockResponse();

            await controller.getPublicPage(req, res);

            expect(mockService.getPageBySlug).toHaveBeenCalledWith('/public');
        });

        it('should return 404 if page not found', async () => {
            mockService.getPageBySlug.mockResolvedValue(null);

            const req = createMockRequest({ params: { slug: 'nonexistent' } });
            const res = createMockResponse();

            await controller.getPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
        });

        it('should return 404 if page is not published', async () => {
            const mockPage = {
                _id: '123',
                title: 'Draft Page',
                slug: '/draft',
                published: false
            };

            mockService.getPageBySlug.mockResolvedValue(mockPage);

            const req = createMockRequest({ params: { slug: 'draft' } });
            const res = createMockResponse();

            await controller.getPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
        });
    });

    describe('renderPublicPage', () => {
        it('should render published page HTML', async () => {
            const mockResponse = {
                html: '<h1>Test Content</h1>',
                metadata: {
                    title: 'Test Page',
                    description: 'A test page',
                    keywords: ['test'],
                    ogImage: undefined
                }
            };

            mockService.renderPublicPageBySlug.mockResolvedValue(mockResponse);

            const req = createMockRequest({ params: { slug: 'test' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(mockService.renderPublicPageBySlug).toHaveBeenCalledWith('/test');
            expect(res.json).toHaveBeenCalledWith({
                ...mockResponse,
                currentSlug: '/test',
                requestedSlug: '/test'
            });
        });

        it('should normalize slug by adding leading slash', async () => {
            const mockResponse = {
                html: '<p>Content</p>',
                metadata: {
                    title: 'Test',
                    description: undefined,
                    keywords: undefined,
                    ogImage: undefined
                }
            };

            mockService.renderPublicPageBySlug.mockResolvedValue(mockResponse);

            const req = createMockRequest({ params: { slug: 'no-leading-slash' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            // Should add leading slash
            expect(mockService.renderPublicPageBySlug).toHaveBeenCalledWith('/no-leading-slash');
            expect(res.json).toHaveBeenCalledWith({
                ...mockResponse,
                currentSlug: '/no-leading-slash',
                requestedSlug: '/no-leading-slash'
            });
        });

        it('should return 404 if page not found', async () => {
            mockService.renderPublicPageBySlug.mockResolvedValue(null);

            const req = createMockRequest({ params: { slug: 'nonexistent' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
        });

        it('should return 404 if page not published', async () => {
            mockService.renderPublicPageBySlug.mockResolvedValue(null);

            const req = createMockRequest({ params: { slug: 'draft' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
        });

        it('should handle rendering errors', async () => {
            mockService.renderPublicPageBySlug.mockRejectedValue(new Error('Render failed'));

            const req = createMockRequest({ params: { slug: 'test' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(500);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to render page',
                message: 'Render failed'
            });
        });

        it('should include all metadata fields when present', async () => {
            const mockResponse = {
                html: '<h1>Complete Page</h1>',
                metadata: {
                    title: 'Complete Page',
                    description: 'A complete description',
                    keywords: ['test', 'complete', 'metadata'],
                    ogImage: 'https://example.com/image.png'
                }
            };

            mockService.renderPublicPageBySlug.mockResolvedValue(mockResponse);

            const req = createMockRequest({ params: { slug: 'complete' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(res.json).toHaveBeenCalledWith({
                ...mockResponse,
                currentSlug: '/complete',
                requestedSlug: '/complete'
            });
        });
    });

    describe('previewMarkdown', () => {
        it('should preview markdown content', async () => {
            const mockContent = '---\ntitle: Test\n---\n# Content';
            const mockResponse = {
                html: '<h1>Content</h1>',
                metadata: {
                    title: 'Test',
                    description: undefined,
                    keywords: undefined,
                    ogImage: undefined
                }
            };

            mockService.previewMarkdown.mockResolvedValue(mockResponse);

            const req = createMockRequest({ body: { content: mockContent } });
            const res = createMockResponse();

            await controller.previewMarkdown(req, res);

            expect(mockService.previewMarkdown).toHaveBeenCalledWith(mockContent);
            expect(res.json).toHaveBeenCalledWith(mockResponse);
        });

        it('should return 400 if content is missing', async () => {
            const req = createMockRequest({ body: {} });
            const res = createMockResponse();

            await controller.previewMarkdown(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Content is required' });
            expect(mockService.previewMarkdown).not.toHaveBeenCalled();
        });

        it('should return 400 if content is empty string', async () => {
            const req = createMockRequest({ body: { content: '' } });
            const res = createMockResponse();

            await controller.previewMarkdown(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Content is required' });
            expect(mockService.previewMarkdown).not.toHaveBeenCalled();
        });

        it('should return 400 if content is only whitespace', async () => {
            const req = createMockRequest({ body: { content: '   \n\t   ' } });
            const res = createMockResponse();

            await controller.previewMarkdown(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({ error: 'Content is required' });
            expect(mockService.previewMarkdown).not.toHaveBeenCalled();
        });

        it('should handle preview errors', async () => {
            mockService.previewMarkdown.mockRejectedValue(new Error('Invalid frontmatter'));

            const req = createMockRequest({ body: { content: '---\ninvalid\n---\n' } });
            const res = createMockResponse();

            await controller.previewMarkdown(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to preview markdown',
                message: 'Invalid frontmatter'
            });
        });

        it('should preview content with all metadata fields', async () => {
            const mockContent = '---\ntitle: Full\ndescription: Desc\nkeywords: [a, b]\nogImage: img.png\n---\nContent';
            const mockResponse = {
                html: '<p>Content</p>',
                metadata: {
                    title: 'Full',
                    description: 'Desc',
                    keywords: ['a', 'b'],
                    ogImage: 'img.png'
                }
            };

            mockService.previewMarkdown.mockResolvedValue(mockResponse);

            const req = createMockRequest({ body: { content: mockContent } });
            const res = createMockResponse();

            await controller.previewMarkdown(req, res);

            expect(res.json).toHaveBeenCalledWith(mockResponse);
        });

        it('should handle content without frontmatter', async () => {
            const mockContent = '# Just Markdown';
            const mockResponse = {
                html: '<h1>Just Markdown</h1>',
                metadata: {}
            };

            mockService.previewMarkdown.mockResolvedValue(mockResponse);

            const req = createMockRequest({ body: { content: mockContent } });
            const res = createMockResponse();

            await controller.previewMarkdown(req, res);

            expect(mockService.previewMarkdown).toHaveBeenCalledWith(mockContent);
            expect(res.json).toHaveBeenCalledWith(mockResponse);
        });
    });

    // ============================================================================
    // Redirect Tests (Public Endpoints)
    // ============================================================================

    describe('getPublicPage - redirect handling', () => {
        it('should return page when current slug matches', async () => {
            const mockPage = {
                _id: '1',
                title: 'Test Page',
                slug: '/current',
                oldSlugs: ['/old-url'],
                published: true
            };

            mockService.getPageBySlug.mockResolvedValue(mockPage);

            const req = createMockRequest({ params: { slug: '/current' } });
            const res = createMockResponse();

            await controller.getPublicPage(req, res);

            expect(res.json).toHaveBeenCalledWith({
                page: mockPage,
                requestedSlug: '/current'
            });
            expect(res.redirect).not.toHaveBeenCalled();
        });

        it('should return page data with old slug when slug is in oldSlugs array', async () => {
            const mockPage = {
                _id: '1',
                title: 'Test Page',
                slug: '/current-url',
                oldSlugs: ['/old-url'],
                published: true
            };

            mockService.getPageBySlug.mockResolvedValue(null);
            mockService.findPageByOldSlug.mockResolvedValue(mockPage);

            const req = createMockRequest({ params: { slug: '/old-url' } });
            const res = createMockResponse();

            await controller.getPublicPage(req, res);

            expect(mockService.findPageByOldSlug).toHaveBeenCalledWith('/old-url');
            expect(res.json).toHaveBeenCalledWith({
                page: mockPage,
                requestedSlug: '/old-url'
            });
            expect(res.redirect).not.toHaveBeenCalled();
        });

        it('should not redirect if redirect target page is unpublished', async () => {
            const unpublishedPage = {
                _id: '1',
                title: 'Test Page',
                slug: '/current-url',
                oldSlugs: ['/old-url'],
                published: false
            };

            mockService.getPageBySlug.mockResolvedValue(null);
            mockService.findPageByOldSlug.mockResolvedValue(unpublishedPage);

            const req = createMockRequest({ params: { slug: '/old-url' } });
            const res = createMockResponse();

            await controller.getPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
        });

        it('should return 404 when slug does not exist anywhere', async () => {
            mockService.getPageBySlug.mockResolvedValue(null);
            mockService.findPageByOldSlug.mockResolvedValue(null);

            const req = createMockRequest({ params: { slug: '/nonexistent' } });
            const res = createMockResponse();

            await controller.getPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
        });

        it('should normalize slug without leading slash', async () => {
            const mockPage = {
                _id: '1',
                title: 'Test Page',
                slug: '/about',
                oldSlugs: [],
                published: true
            };

            mockService.getPageBySlug.mockResolvedValue(mockPage);

            const req = createMockRequest({ params: { slug: 'about' } });
            const res = createMockResponse();

            await controller.getPublicPage(req, res);

            expect(mockService.getPageBySlug).toHaveBeenCalledWith('/about');
            expect(res.json).toHaveBeenCalledWith({
                page: mockPage,
                requestedSlug: '/about'
            });
        });
    });

    describe('renderPublicPage - redirect handling', () => {
        it('should return rendered HTML when current slug matches', async () => {
            const mockRender = {
                html: '<h1>Test</h1>',
                metadata: {
                    title: 'Test Page',
                    description: 'Test description'
                }
            };

            mockService.renderPublicPageBySlug.mockResolvedValue(mockRender);

            const req = createMockRequest({ params: { slug: '/current' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(res.json).toHaveBeenCalledWith({
                ...mockRender,
                currentSlug: '/current',
                requestedSlug: '/current'
            });
            expect(res.redirect).not.toHaveBeenCalled();
        });

        it('should return rendered content with slug info when slug is in oldSlugs array', async () => {
            const mockPage = {
                _id: '1',
                title: 'Test Page',
                slug: '/current-url',
                oldSlugs: ['/old-url'],
                published: true
            };

            const mockRender = {
                html: '<h1>Test</h1>',
                metadata: {
                    title: 'Test Page',
                    description: 'Test description'
                }
            };

            mockService.renderPublicPageBySlug.mockResolvedValueOnce(null);
            mockService.findPageByOldSlug.mockResolvedValue(mockPage);
            mockService.renderPublicPageBySlug.mockResolvedValueOnce(mockRender);

            const req = createMockRequest({ params: { slug: '/old-url' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(mockService.findPageByOldSlug).toHaveBeenCalledWith('/old-url');
            expect(mockService.renderPublicPageBySlug).toHaveBeenCalledWith('/current-url');
            expect(res.json).toHaveBeenCalledWith({
                ...mockRender,
                currentSlug: '/current-url',
                requestedSlug: '/old-url'
            });
            expect(res.redirect).not.toHaveBeenCalled();
        });

        it('should not redirect if redirect target page is unpublished', async () => {
            const unpublishedPage = {
                _id: '1',
                title: 'Test Page',
                slug: '/current-url',
                oldSlugs: ['/old-url'],
                published: false
            };

            mockService.renderPublicPageBySlug.mockResolvedValue(null);
            mockService.findPageByOldSlug.mockResolvedValue(unpublishedPage);

            const req = createMockRequest({ params: { slug: '/old-url' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
        });

        it('should return 404 when slug does not exist anywhere', async () => {
            mockService.renderPublicPageBySlug.mockResolvedValue(null);
            mockService.findPageByOldSlug.mockResolvedValue(null);

            const req = createMockRequest({ params: { slug: '/nonexistent' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(res.json).toHaveBeenCalledWith({ error: 'Page not found' });
        });

        it('should handle old slugs for nested paths', async () => {
            const mockPage = {
                _id: '1',
                title: 'Test Page',
                slug: '/blog/posts/2025/article',
                oldSlugs: ['/blog/article'],
                published: true
            };

            const mockRender = {
                html: '<h1>Article</h1>',
                metadata: {
                    title: 'Article',
                    description: 'Article description'
                }
            };

            mockService.renderPublicPageBySlug.mockResolvedValueOnce(null);
            mockService.findPageByOldSlug.mockResolvedValue(mockPage);
            mockService.renderPublicPageBySlug.mockResolvedValueOnce(mockRender);

            const req = createMockRequest({ params: { slug: '/blog/article' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(mockService.renderPublicPageBySlug).toHaveBeenCalledWith('/blog/posts/2025/article');
            expect(res.json).toHaveBeenCalledWith({
                ...mockRender,
                currentSlug: '/blog/posts/2025/article',
                requestedSlug: '/blog/article'
            });
        });
    });
});
