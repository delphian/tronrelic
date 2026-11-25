/**
 * @fileoverview The translated title of each section of the address page.
 *
 * While a section streams in, its placeholder carries the same title as the
 * panel that replaces it, so the page does not change its headings under the
 * reader. Keeping the titles here means the placeholder and the panel cannot
 * drift apart.
 */

import type { AddressExplorerSpanSection, ITranslator } from '@/types';

/** Every section of the address page: the span sections plus the transfers list. */
export type AddressExplorerSectionName = AddressExplorerSpanSection | 'transfers';

/**
 * Translate a section's title.
 *
 * @param t - The translation function of the component rendering the title.
 * @param name - The section.
 * @returns The section's title in the page's language.
 */
export function sectionTitle(t: ITranslator['t'], name: AddressExplorerSectionName): string {
    const titles: Record<AddressExplorerSectionName, string> = {
        profile: t('addressExplorer.summary.title', 'Summary'),
        counterparties: t('addressExplorer.counterparties.title', 'Counterparties'),
        transfers: t('addressExplorer.transfers.title', 'Transfers'),
        delegations: t('addressExplorer.delegations.title', 'Energy and bandwidth delegations'),
        permissions: t('addressExplorer.permissions.title', 'Permission changes')
    };
    return titles[name];
}
