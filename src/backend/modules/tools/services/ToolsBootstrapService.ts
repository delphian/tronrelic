/**
 * @fileoverview Lists and creates the CMS pages the tools module ships.
 *
 * The tools module offers pages, such as the stake calculator's, that an
 * admin creates by clicking Create on `/system/tools`. Creating one proposes
 * it through `IPageService.proposePage`, the same path an AI tool uses, so it
 * waits in `/system/curation` until a curator approves or rejects it. A page
 * is created only when no page holds its address at that moment; the button
 * can be used again whenever the address is free, however many times the
 * page existed before.
 */

import type { IPage, IPageService, IPageSlugHolder, ISystemLogService, IToolsBootstrapPage, ToolsBootstrapPageState } from '@/types';
import type { IToolsBootstrapItem } from './IToolsBootstrapItem.js';
import { ToolsBootstrapError } from './ToolsBootstrapError.js';

/**
 * Work out the state of a page holding an address from its review and
 * deletion fields.
 *
 * A page the adoption migration has not reached has no review state, so its
 * own `published` flag decides between approved and draft.
 *
 * @param page - The holding page's latest edit.
 * @returns The state the Bootstrap tab shows for the address.
 */
function stateOfHolder(page: IPage): ToolsBootstrapPageState {
    let state: ToolsBootstrapPageState;
    if (page.deletedAt) {
        state = 'deleted';
    } else if (page.hasApprovedVersion || (!page.contentId && page.published)) {
        state = 'approved';
    } else if (page.curation === 'pending') {
        state = 'pending';
    } else if (page.curation === 'rejected') {
        state = 'rejected';
    } else {
        state = 'draft';
    }

    return state;
}

/**
 * Lists the tools module's bootstrap pages with their state, and creates one
 * on an admin's request.
 *
 * Constructed once by the tools module and handed to its admin controller; it
 * has no `IXxxService` interface because nothing outside the module uses it.
 */
export class ToolsBootstrapService {
    /**
     * @param pageService - The pages module's service: `findPageHoldingSlug`
     *   to read each address's state, and `proposePage` to create a page held
     *   for review.
     * @param items - The pages the module offers, in display order.
     * @param logger - The tools module's logger, so entries reach its Logs tab.
     */
    constructor(
        private readonly pageService: IPageService,
        private readonly items: ReadonlyArray<IToolsBootstrapItem>,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Every bootstrap page with the current state of its address.
     *
     * @returns One row per offered page, in display order.
     */
    async list(): Promise<IToolsBootstrapPage[]> {
        return Promise.all(this.items.map((item) => this.describe(item)));
    }

    /**
     * Propose one bootstrap page for curator review, if its address is free.
     *
     * The address is checked first so the admin gets a plain reason when a
     * page already holds it. Two clicks racing past that check still cannot
     * create two pages, because the pages module refuses the second create
     * on the same address and its refusal reaches the caller.
     *
     * @param id - The bootstrap entry to create.
     * @returns The entry's row after the proposal, now in the `pending` state,
     *   and the id of the curation item holding it.
     * @throws ToolsBootstrapError when the entry is unknown or a page already
     *   holds its address.
     * @throws PageInputError or ContentError when the pages module or the
     *   content service refuses the proposal.
     */
    async create(id: string): Promise<{ page: IToolsBootstrapPage; curationId: string }> {
        const item = this.items.find((candidate) => candidate.id === id);
        if (!item) {
            throw new ToolsBootstrapError('unknown-entry', `No bootstrap page has the id "${id}"`);
        }

        const before = await this.describe(item);
        if (before.state !== 'absent') {
            throw new ToolsBootstrapError(
                'address-held',
                `A page already holds ${item.proposal.slug} (${before.state}), so a new one cannot be created there`
            );
        }

        const result = await this.pageService.proposePage(item.proposal);
        this.logger.info(
            { entry: item.id, pageId: result.pageId, curationId: result.curationId, slug: result.slug },
            'Bootstrap page proposed for curator review'
        );

        return { page: await this.describe(item), curationId: result.curationId };
    }

    /**
     * Build one entry's row from the page holding its address.
     *
     * @param item - The bootstrap entry.
     * @returns The row the Bootstrap tab shows.
     */
    private async describe(item: IToolsBootstrapItem): Promise<IToolsBootstrapPage> {
        const holder: IPageSlugHolder | null = await this.pageService.findPageHoldingSlug(item.proposal.slug);
        const state: ToolsBootstrapPageState = !holder ? 'absent' : holder.holds === 'redirect' ? 'redirect' : stateOfHolder(holder.page);

        return {
            id: item.id,
            label: item.label,
            description: item.description,
            slug: item.proposal.slug,
            state,
            holder: holder
                ? { contentId: holder.page.contentId, title: holder.page.title, slug: holder.page.slug }
                : null
        };
    }
}
