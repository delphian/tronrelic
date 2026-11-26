/**
 * @fileoverview Lists and creates the default CMS pages modules and plugins ship.
 *
 * A component such as the tools module or a plugin offers pages, such as a
 * tool's page, that an admin creates by clicking Create on the component's
 * Bootstrap tab. Creating one proposes it through `IPageService.proposePage`,
 * the same path an AI tool uses, so it waits in `/system/curation` until a
 * curator approves or rejects it. A page is created only while no page holds
 * its address; the button can be used again whenever the address is free.
 *
 * Published on the registry as `'page-bootstrap'`, which is how a plugin
 * reaches the pages module at all. The narrow surface is deliberate: the full
 * page service can write as a curator and change the route blacklist.
 */

import type {
    IPage,
    IPageBootstrapCatalog,
    IPageBootstrapCreateResult,
    IPageBootstrapItem,
    IPageBootstrapRow,
    IPageBootstrapService,
    IPageService,
    PageBootstrapState,
    ISystemLogService
} from '@/types';
import { isContentError } from '../../../services/content-error.js';
import { PageInputError } from './PageInputError.js';

/**
 * The two page-service calls a catalog makes. Declared narrowly so the
 * bootstrap service depends on what it uses rather than the whole service.
 */
export type IPageBootstrapPageAccess = Pick<IPageService, 'findPageHoldingSlug' | 'proposePage'>;

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
function stateOfHolder(page: IPage): PageBootstrapState {
    let state: PageBootstrapState;
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
 * One component's bootstrap entries bound to the pages module. A utility
 * built per component by `PageBootstrapService.createCatalog`, so it is not
 * a singleton.
 */
class PageBootstrapCatalog implements IPageBootstrapCatalog {
    /**
     * @param pages - Reads which page holds an address and proposes pages.
     * @param items - The component's entries, in display order.
     * @param logger - The component's logger, so entries reach its Logs tab.
     */
    constructor(
        private readonly pages: IPageBootstrapPageAccess,
        private readonly items: ReadonlyArray<IPageBootstrapItem>,
        private readonly logger: ISystemLogService
    ) {}

    /** @inheritdoc */
    async list(): Promise<IPageBootstrapRow[]> {
        return Promise.all(this.items.map((item) => this.describe(item)));
    }

    /** @inheritdoc */
    async create(id: string): Promise<IPageBootstrapCreateResult> {
        const item = this.items.find((candidate) => candidate.id === id);
        let result: IPageBootstrapCreateResult;
        if (!item) {
            result = { created: false, reason: 'unknown-entry', message: `No bootstrap page has the id "${id}"` };
        } else {
            const before = await this.describe(item);
            result = before.state === 'absent'
                ? await this.propose(item)
                : this.addressHeld(item, before);
        }

        return result;
    }

    /**
     * Propose the entry's page and turn each refusal the admin should read
     * into a result, leaving only failures with no known cause to throw.
     *
     * A `PageInputError` is either the address being taken between the check
     * and the write, or a field the pages module refused. The address is read
     * again to tell the two apart, because the error carries only a message.
     *
     * @param item - An entry whose address was free a moment ago.
     * @returns The created row, or the refusal.
     */
    private async propose(item: IPageBootstrapItem): Promise<IPageBootstrapCreateResult> {
        let result: IPageBootstrapCreateResult;
        try {
            const proposed = await this.pages.proposePage(item.proposal);
            this.logger.info(
                { entry: item.id, pageId: proposed.pageId, curationId: proposed.curationId, slug: proposed.slug },
                'Bootstrap page proposed for curator review'
            );
            result = { created: true, row: await this.describe(item), curationId: proposed.curationId };
        } catch (error) {
            if (error instanceof PageInputError) {
                const after = await this.describe(item);
                result = after.state === 'absent'
                    ? { created: false, reason: 'invalid-proposal', message: error.message }
                    : this.addressHeld(item, after);
            } else if (isContentError(error) && (error.code === 'vetoed' || error.code === 'curation-unavailable')) {
                result = { created: false, reason: error.code, message: error.message };
            } else {
                throw error;
            }
        }

        return result;
    }

    /**
     * The refusal for an address a page already holds, naming its state so
     * the admin knows where to look.
     *
     * @param item - The entry that could not be created.
     * @param row - The entry's current row.
     * @returns The `address-held` refusal.
     */
    private addressHeld(item: IPageBootstrapItem, row: IPageBootstrapRow): IPageBootstrapCreateResult {
        return {
            created: false,
            reason: 'address-held',
            message: `A page already holds ${item.proposal.slug} (${row.state}), so a new one cannot be created there`
        };
    }

    /**
     * Build one entry's row from the page holding its address.
     *
     * @param item - The bootstrap entry.
     * @returns The row the Bootstrap tab shows.
     */
    private async describe(item: IPageBootstrapItem): Promise<IPageBootstrapRow> {
        const holder = await this.pages.findPageHoldingSlug(item.proposal.slug);
        const state: PageBootstrapState = !holder ? 'absent' : holder.holds === 'redirect' ? 'redirect' : stateOfHolder(holder.page);

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

/**
 * Singleton implementing `IPageBootstrapService`.
 *
 * Singleton because it is a published service configured once at bootstrap
 * by the pages module and consumed by the tools module and by plugins.
 */
export class PageBootstrapService implements IPageBootstrapService {
    private static instance: PageBootstrapService | null = null;

    /**
     * @param pages - The page service calls every catalog makes.
     */
    private constructor(private readonly pages: IPageBootstrapPageAccess) {}

    /**
     * Configure the singleton. The first call wins.
     *
     * @param pages - The page service, or the two calls of it a catalog makes.
     */
    public static setDependencies(pages: IPageBootstrapPageAccess): void {
        if (!PageBootstrapService.instance) {
            PageBootstrapService.instance = new PageBootstrapService(pages);
        }
    }

    /**
     * Return the configured singleton.
     *
     * @returns The bootstrap service.
     * @throws When `setDependencies` has not run yet.
     */
    public static getInstance(): PageBootstrapService {
        if (!PageBootstrapService.instance) {
            throw new Error('PageBootstrapService.setDependencies() must be called before getInstance()');
        }

        return PageBootstrapService.instance;
    }

    /**
     * Drop the singleton so each test builds a fresh service against its own mocks.
     */
    public static resetForTests(): void {
        PageBootstrapService.instance = null;
    }

    /** @inheritdoc */
    createCatalog(items: ReadonlyArray<IPageBootstrapItem>, logger: ISystemLogService): IPageBootstrapCatalog {
        const ids = new Set<string>();
        for (const item of items) {
            if (ids.has(item.id)) {
                throw new Error(`Two bootstrap pages share the id "${item.id}"; each entry needs its own`);
            }
            ids.add(item.id);
        }

        return new PageBootstrapCatalog(this.pages, items, logger);
    }
}
