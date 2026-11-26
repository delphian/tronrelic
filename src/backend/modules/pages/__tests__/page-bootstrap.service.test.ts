/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for PageBootstrapService and the catalogs it builds.
 *
 * A Bootstrap tab must report each address's state the way the pages module
 * judges it, create a page only when nothing holds the address, however many
 * times the page existed before, and hand back every refusal the admin should
 * read as a result a plugin can map to a status without core's error classes.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IPage, IPageBootstrapItem, IPageSlugHolder, ISystemLogService } from '@/types';
import { PageBootstrapService } from '../services/page-bootstrap.service.js';
import { PageInputError } from '../services/PageInputError.js';
import { ContentError } from '../../../services/content-error.js';

/** Logger whose calls the tests can inspect. */
function createLogger(): ISystemLogService {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ISystemLogService;
}

/** One entry at `/tools/example`, the shape a component offers. */
const ITEM: IPageBootstrapItem = {
    id: 'example',
    label: 'Example page',
    description: 'A page for the tests.',
    proposal: { title: 'Example', slug: '/tools/example', body: '# Example', description: 'Example page', source: 'test-component' }
};

/** A holder for the example address with the given page fields. */
function holder(fields: Partial<IPage>, holds: IPageSlugHolder['holds'] = 'slug'): IPageSlugHolder {
    return {
        holds,
        page: { contentId: 'page-1', title: 'Old page', slug: '/tools/example', oldSlugs: [], content: '', description: '', keywords: [], published: true, ...fields } as IPage
    };
}

describe('PageBootstrapService', () => {
    let findPageHoldingSlug: ReturnType<typeof vi.fn>;
    let proposePage: ReturnType<typeof vi.fn>;
    let logger: ISystemLogService;

    beforeEach(() => {
        PageBootstrapService.resetForTests();
        findPageHoldingSlug = vi.fn().mockResolvedValue(null);
        proposePage = vi.fn().mockResolvedValue({ pageId: 'page-2', slug: '/tools/example', pendingReview: true, curationId: 'cur-1' });
        logger = createLogger();
        PageBootstrapService.setDependencies({ findPageHoldingSlug, proposePage } as any);
    });

    /** The catalog the tests drive. */
    function catalog() {
        return PageBootstrapService.getInstance().createCatalog([ITEM], logger);
    }

    it('lists an entry as absent when no page holds its address', async () => {
        const [row] = await catalog().list();

        expect(row).toMatchObject({ id: 'example', slug: '/tools/example', state: 'absent', holder: null });
        expect(findPageHoldingSlug).toHaveBeenCalledWith('/tools/example');
    });

    it.each([
        [{ curation: 'pending', hasApprovedVersion: false }, 'slug', 'pending'],
        [{ curation: 'approved', hasApprovedVersion: true }, 'slug', 'approved'],
        [{ curation: 'pending', hasApprovedVersion: true }, 'slug', 'approved'],
        [{ curation: 'rejected', hasApprovedVersion: false }, 'slug', 'rejected'],
        [{ deletedAt: new Date(), hasApprovedVersion: true }, 'slug', 'deleted'],
        [{ hasApprovedVersion: false, published: false }, 'slug', 'draft'],
        [{ hasApprovedVersion: true }, 'redirect', 'redirect']
    ] as const)('reports %o held by %s as %s', async (fields, holds, state) => {
        findPageHoldingSlug.mockResolvedValue(holder(fields as Partial<IPage>, holds));

        const [row] = await catalog().list();

        expect(row.state).toBe(state);
        expect(row.holder).toMatchObject({ contentId: 'page-1', title: 'Old page' });
    });

    it('proposes the page when its address is free and logs on the owner\'s logger', async () => {
        findPageHoldingSlug.mockResolvedValueOnce(null).mockResolvedValueOnce(holder({ curation: 'pending', hasApprovedVersion: false }));

        const result = await catalog().create('example');

        expect(proposePage).toHaveBeenCalledWith(ITEM.proposal);
        expect(result).toMatchObject({ created: true, curationId: 'cur-1', row: { state: 'pending' } });
        expect(logger.info).toHaveBeenCalled();
    });

    /** A page that existed before and no longer holds the address must not block a new one. */
    it('creates again once the address is free, however often it was created before', async () => {
        const pages = catalog();
        await pages.create('example');
        await pages.create('example');

        expect(proposePage).toHaveBeenCalledTimes(2);
    });

    it('refuses without writing when a page holds the address', async () => {
        findPageHoldingSlug.mockResolvedValue(holder({ deletedAt: new Date() }));

        const result = await catalog().create('example');

        expect(result).toMatchObject({ created: false, reason: 'address-held' });
        expect(proposePage).not.toHaveBeenCalled();
    });

    it('refuses an unknown entry', async () => {
        const result = await catalog().create('nope');

        expect(result).toMatchObject({ created: false, reason: 'unknown-entry' });
        expect(proposePage).not.toHaveBeenCalled();
    });

    /** Two clicks racing past the check: the pages module refuses the second on the taken slug. */
    it('reports a slug taken between the check and the write as address-held', async () => {
        findPageHoldingSlug.mockResolvedValueOnce(null).mockResolvedValueOnce(holder({ curation: 'pending', hasApprovedVersion: false }));
        proposePage.mockRejectedValue(new PageInputError('A page with slug /tools/example already exists'));

        const result = await catalog().create('example');

        expect(result).toMatchObject({ created: false, reason: 'address-held' });
    });

    it('reports a field the pages module refused as invalid-proposal', async () => {
        proposePage.mockRejectedValue(new PageInputError('The description is required'));

        const result = await catalog().create('example');

        expect(result).toMatchObject({ created: false, reason: 'invalid-proposal', message: 'The description is required' });
    });

    it.each(['vetoed', 'curation-unavailable'] as const)('returns a %s content refusal as a result', async (code) => {
        proposePage.mockRejectedValue(new ContentError(code, 'refused'));

        const result = await catalog().create('example');

        expect(result).toMatchObject({ created: false, reason: code });
    });

    it('throws a failure with no known cause', async () => {
        proposePage.mockRejectedValue(new Error('connection lost'));

        await expect(catalog().create('example')).rejects.toThrow('connection lost');
    });

    it('refuses a catalog whose entries share an id', () => {
        expect(() => PageBootstrapService.getInstance().createCatalog([ITEM, ITEM], logger)).toThrow(/share the id/);
    });
});
