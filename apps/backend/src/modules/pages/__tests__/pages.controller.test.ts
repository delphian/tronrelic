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
    listPages = vi.fn();
    deletePage = vi.fn();
    getPageStats = vi.fn();
    renderPageHtml = vi.fn();
    invalidatePageCache = vi.fn();
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
        send: vi.fn().mockReturnThis()
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

            mockService.uploadFile.mockResolvedValue(mockFile);

            const req = createMockRequest({
                file: {
                    buffer: Buffer.from('test'),
                    originalname: 'test.png',
                    mimetype: 'image/png'
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

        it('should handle upload errors', async () => {
            mockService.uploadFile.mockRejectedValue(new Error('File too large'));

            const req = createMockRequest({
                file: {
                    buffer: Buffer.from('test'),
                    originalname: 'test.png',
                    mimetype: 'image/png'
                } as any
            });
            const res = createMockResponse();

            await controller.uploadFile(req, res);

            expect(res.status).toHaveBeenCalledWith(400);
            expect(res.json).toHaveBeenCalledWith({
                error: 'Failed to upload file',
                message: 'File too large'
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
            expect(res.json).toHaveBeenCalledWith({ page: mockPage });
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
            const mockPage = {
                _id: '123',
                title: 'Test Page',
                slug: '/test',
                published: true,
                description: 'A test page',
                keywords: ['test']
            };

            const mockHtml = '<h1>Test Content</h1>';

            mockService.getPageBySlug.mockResolvedValue(mockPage);
            mockService.renderPageHtml.mockResolvedValue(mockHtml);

            const req = createMockRequest({ params: { slug: 'test' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(mockService.getPageBySlug).toHaveBeenCalledWith('/test');
            expect(mockService.renderPageHtml).toHaveBeenCalledWith(mockPage);
            expect(res.json).toHaveBeenCalledWith({
                html: mockHtml,
                metadata: {
                    title: 'Test Page',
                    description: 'A test page',
                    keywords: ['test'],
                    ogImage: undefined
                }
            });
        });

        it('should return 404 if page not published', async () => {
            const mockPage = {
                _id: '123',
                title: 'Draft',
                slug: '/draft',
                published: false
            };

            mockService.getPageBySlug.mockResolvedValue(mockPage);

            const req = createMockRequest({ params: { slug: 'draft' } });
            const res = createMockResponse();

            await controller.renderPublicPage(req, res);

            expect(res.status).toHaveBeenCalledWith(404);
            expect(mockService.renderPageHtml).not.toHaveBeenCalled();
        });
    });
});
