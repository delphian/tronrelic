/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for ToolsBootstrapService.
 *
 * The Bootstrap tab must report each address's state the way the pages module
 * judges it, and create a page only when nothing holds the address, however
 * many times the page existed before.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { IPage, IPageSlugHolder, ISystemLogService } from '@/types';
import { ToolsBootstrapService } from '../services/ToolsBootstrapService.js';
import { ToolsBootstrapError } from '../services/ToolsBootstrapError.js';
import { TOOLS_BOOTSTRAP_PAGES } from '../services/TOOLS_BOOTSTRAP_PAGES.js';

/** Logger whose calls the tests can inspect. */
function createLogger(): ISystemLogService {
    return { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as ISystemLogService;
}

/** A holder for the stake calculator address with the given page fields. */
function holder(fields: Partial<IPage>, holds: IPageSlugHolder['holds'] = 'slug'): IPageSlugHolder {
    return {
        holds,
        page: { contentId: 'page-1', title: 'Old page', slug: '/tools/stake-calculator', oldSlugs: [], content: '', description: '', keywords: [], published: true, ...fields } as IPage
    };
}

describe('ToolsBootstrapService', () => {
    let findPageHoldingSlug: ReturnType<typeof vi.fn>;
    let proposePage: ReturnType<typeof vi.fn>;
    let service: ToolsBootstrapService;

    beforeEach(() => {
        findPageHoldingSlug = vi.fn().mockResolvedValue(null);
        proposePage = vi.fn().mockResolvedValue({ pageId: 'page-2', slug: '/tools/stake-calculator', pendingReview: true, curationId: 'cur-1' });
        service = new ToolsBootstrapService({ findPageHoldingSlug, proposePage } as any, TOOLS_BOOTSTRAP_PAGES, createLogger());
    });

    it('lists the stake calculator page as absent when no page holds its address', async () => {
        const [row] = await service.list();

        expect(row).toMatchObject({ id: 'stake-calculator', slug: '/tools/stake-calculator', state: 'absent', holder: null });
        expect(findPageHoldingSlug).toHaveBeenCalledWith('/tools/stake-calculator');
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

        const [row] = await service.list();

        expect(row.state).toBe(state);
        expect(row.holder).toMatchObject({ contentId: 'page-1', title: 'Old page' });
    });

    it('proposes the page when its address is free', async () => {
        findPageHoldingSlug.mockResolvedValueOnce(null).mockResolvedValueOnce(holder({ curation: 'pending', hasApprovedVersion: false }));

        const result = await service.create('stake-calculator');

        expect(proposePage).toHaveBeenCalledWith(TOOLS_BOOTSTRAP_PAGES[0].proposal);
        expect(result).toMatchObject({ curationId: 'cur-1', page: { state: 'pending' } });
    });

    /** A page that existed before and no longer holds the address must not block a new one. */
    it('creates again once the address is free, however often it was created before', async () => {
        await service.create('stake-calculator');
        await service.create('stake-calculator');

        expect(proposePage).toHaveBeenCalledTimes(2);
    });

    it('refuses without writing when a page holds the address', async () => {
        findPageHoldingSlug.mockResolvedValue(holder({ deletedAt: new Date() }));

        await expect(service.create('stake-calculator')).rejects.toMatchObject({ code: 'address-held' });
        expect(proposePage).not.toHaveBeenCalled();
    });

    it('refuses an unknown entry', async () => {
        await expect(service.create('nope')).rejects.toBeInstanceOf(ToolsBootstrapError);
        expect(proposePage).not.toHaveBeenCalled();
    });

    it('proposes a page whose body embeds the calculator widget at its default address', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[0];

        expect(proposal.slug).toBe('/tools/stake-calculator');
        expect(proposal.source).toBe('tools-module');
        expect(proposal.body).toContain('```widget\n{"type":"tools:stake-calculator","config":{}}\n```');
    });

    /**
     * Approving the page must change no visible text, so the proposal repeats
     * the built-in page's title, description, heading, and intro line. These
     * literals mirror the `t()` defaults in StakeCalculator.tsx and the
     * stake calculator route's metadata.
     */
    it('proposes the same visible text the built-in page shows', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[0];

        expect(proposal.title).toBe('TRON Stake Calculator | TRX Staking Energy & Bandwidth Yield');
        expect(proposal.description).toBe('Calculate energy and bandwidth yield from staking TRX on the TRON network. Compare staking returns against renting energy from delegation markets.');
        expect(proposal.body.startsWith('# Stake Calculator\n\nCalculate energy from TRX or TRX from energy using live network parameters\n\n```widget')).toBe(true);
    });
});
