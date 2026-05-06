/// <reference types="vitest" />

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { PagesController } from '../api/pages.controller.js';
import type { IPageService } from '@/types';
import type { Request, Response } from 'express';

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
    getSettings = vi.fn();
    updateSettings = vi.fn();
    sanitizeSlug = vi.fn();
    isSlugBlacklisted = vi.fn();
}

const mockLogger = {
    info: vi.fn(),
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    child: vi.fn(() => mockLogger)
} as any;

function createMockRequest(overrides: Partial<Request> = {}): Request {
    return {
        params: {},
        query: {},
        body: {},
        ...overrides
    } as Request;
}

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

    describe('listPages', () => {
        it('returns pages with stats', async () => {
            mockService.listPages.mockResolvedValue([{ _id: '1' }]);
            mockService.getPageStats.mockResolvedValue({ total: 1, published: 1, drafts: 0 });

            const req = createMockRequest();
            const res = createMockResponse();
            await controller.listPages(req, res);

            expect(res.json).toHaveBeenCalledWith({
                pages: [{ _id: '1' }],
                stats: { total: 1, published: 1, drafts: 0 }
            });
        });

        it('returns 500 when the service throws', async () => {
            mockService.listPages.mockRejectedValue(new Error('boom'));
            const res = createMockResponse();
            await controller.listPages(createMockRequest(), res);
            expect(res.status).toHaveBeenCalledWith(500);
        });
    });

    describe('getPage', () => {
        it('returns 404 when the page is missing', async () => {
            mockService.getPageById.mockResolvedValue(null);
            const res = createMockResponse();
            await controller.getPage(createMockRequest({ params: { id: 'x' } }), res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('returns the page when found', async () => {
            mockService.getPageById.mockResolvedValue({ _id: 'x', title: 'X' });
            const res = createMockResponse();
            await controller.getPage(createMockRequest({ params: { id: 'x' } }), res);
            expect(res.json).toHaveBeenCalledWith({ _id: 'x', title: 'X' });
        });
    });

    describe('createPage', () => {
        it('creates and returns 201 on success', async () => {
            mockService.createPage.mockResolvedValue({ _id: 'a' });
            const res = createMockResponse();
            await controller.createPage(createMockRequest({ body: { content: 'x' } }), res);
            expect(res.status).toHaveBeenCalledWith(201);
            expect(res.json).toHaveBeenCalledWith({ _id: 'a' });
        });

        it('returns 400 when content is missing', async () => {
            const res = createMockResponse();
            await controller.createPage(createMockRequest({ body: {} }), res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('returns 400 when the service throws a validation error', async () => {
            mockService.createPage.mockRejectedValue(new Error('invalid'));
            const res = createMockResponse();
            await controller.createPage(createMockRequest({ body: { content: 'x' } }), res);
            expect(res.status).toHaveBeenCalledWith(400);
        });
    });

    describe('updatePage', () => {
        it('returns the updated page', async () => {
            mockService.updatePage.mockResolvedValue({ _id: 'x' });
            const res = createMockResponse();
            await controller.updatePage(
                createMockRequest({ params: { id: 'x' }, body: { content: 'x' } }),
                res
            );
            expect(res.json).toHaveBeenCalledWith({ _id: 'x' });
        });

        it('returns 404 when the page is not found', async () => {
            mockService.updatePage.mockRejectedValue(new Error('Page with ID x not found'));
            const res = createMockResponse();
            await controller.updatePage(
                createMockRequest({ params: { id: 'x' }, body: { content: 'x' } }),
                res
            );
            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    describe('deletePage', () => {
        it('returns 204 on success', async () => {
            mockService.deletePage.mockResolvedValue(undefined);
            const res = createMockResponse();
            await controller.deletePage(createMockRequest({ params: { id: 'x' } }), res);
            expect(res.status).toHaveBeenCalledWith(204);
            expect(res.send).toHaveBeenCalled();
        });

        it('returns 404 when the page is missing', async () => {
            mockService.deletePage.mockRejectedValue(new Error('not found'));
            const res = createMockResponse();
            await controller.deletePage(createMockRequest({ params: { id: 'x' } }), res);
            expect(res.status).toHaveBeenCalledWith(404);
        });
    });

    describe('previewMarkdown', () => {
        it('returns 400 when content is missing', async () => {
            const res = createMockResponse();
            await controller.previewMarkdown(createMockRequest({ body: {} }), res);
            expect(res.status).toHaveBeenCalledWith(400);
        });

        it('returns the preview when content is present', async () => {
            mockService.previewMarkdown.mockResolvedValue({ html: '<h1>X</h1>', metadata: {} });
            const res = createMockResponse();
            await controller.previewMarkdown(createMockRequest({ body: { content: '# X' } }), res);
            expect(res.json).toHaveBeenCalledWith({ html: '<h1>X</h1>', metadata: {} });
        });
    });

    describe('settings', () => {
        it('returns current settings', async () => {
            mockService.getSettings.mockResolvedValue({ blacklistedRoutes: ['^/api/.*'] });
            const res = createMockResponse();
            await controller.getSettings(createMockRequest(), res);
            expect(res.json).toHaveBeenCalledWith({ blacklistedRoutes: ['^/api/.*'] });
        });

        it('updates settings', async () => {
            mockService.updateSettings.mockResolvedValue({ blacklistedRoutes: ['^/x/.*'] });
            const res = createMockResponse();
            await controller.updateSettings(
                createMockRequest({ body: { blacklistedRoutes: ['^/x/.*'] } }),
                res
            );
            expect(res.json).toHaveBeenCalledWith({ blacklistedRoutes: ['^/x/.*'] });
        });
    });

    describe('public endpoints', () => {
        it('getPublicPage returns 404 when page is unpublished and no redirect exists', async () => {
            mockService.getPageBySlug.mockResolvedValue(null);
            mockService.findPageByOldSlug.mockResolvedValue(null);
            const res = createMockResponse();
            await controller.getPublicPage(createMockRequest({ params: { slug: 'x' } }), res);
            expect(res.status).toHaveBeenCalledWith(404);
        });

        it('getPublicPage returns the page with a normalized slug', async () => {
            mockService.getPageBySlug.mockResolvedValue({ slug: '/x', published: true });
            const res = createMockResponse();
            await controller.getPublicPage(createMockRequest({ params: { slug: 'x' } }), res);
            expect(res.json).toHaveBeenCalledWith({
                page: { slug: '/x', published: true },
                requestedSlug: '/x'
            });
        });

        it('renderPublicPage returns rendered HTML and metadata', async () => {
            mockService.renderPublicPageBySlug.mockResolvedValue({
                html: '<h1>X</h1>',
                metadata: { title: 'X' }
            });
            const res = createMockResponse();
            await controller.renderPublicPage(createMockRequest({ params: { slug: 'x' } }), res);
            expect(res.json).toHaveBeenCalledWith({
                html: '<h1>X</h1>',
                metadata: { title: 'X' },
                currentSlug: '/x',
                requestedSlug: '/x'
            });
        });

        it('renderPublicPage falls back through a redirect on miss', async () => {
            mockService.renderPublicPageBySlug
                .mockResolvedValueOnce(null)
                .mockResolvedValueOnce({ html: '<h1>Y</h1>', metadata: { title: 'Y' } });
            mockService.findPageByOldSlug.mockResolvedValue({ slug: '/y', published: true });

            const res = createMockResponse();
            await controller.renderPublicPage(createMockRequest({ params: { slug: 'x' } }), res);
            expect(res.json).toHaveBeenCalledWith({
                html: '<h1>Y</h1>',
                metadata: { title: 'Y' },
                currentSlug: '/y',
                requestedSlug: '/x'
            });
        });
    });
});
