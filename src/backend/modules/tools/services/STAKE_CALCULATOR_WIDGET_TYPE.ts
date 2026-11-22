/**
 * @fileoverview Widget-type registration for the embeddable stake calculator.
 *
 * Registering the calculator as a widget type lets any CMS page or blog post
 * embed it with a ` ```widget ` block, which is how the proposed stake
 * calculator page places the form inside editable text. The frontend renders
 * it with the component keyed on the same id in `widgets.core.ts`.
 *
 * - The calculator is driven entirely by what the visitor types, so the server
 *   supplies no data and the fetcher returns an empty object.
 * - It takes no settings, so it declares an empty settings schema and the
 *   Insert widget picker shows no form for it.
 * - It renders nothing taken from its settings and nothing specific to the
 *   visitor, so it is safe to embed in a page any author can propose.
 */

import type { IRegisterWidgetTypeInput } from '@/types';
import { STAKE_CALCULATOR_WIDGET_TYPE_ID } from '@/types';

/**
 * Registration input the tools module passes to `IWidgetsService.registerType`.
 */
export const STAKE_CALCULATOR_WIDGET_TYPE: IRegisterWidgetTypeInput = {
    id: STAKE_CALCULATOR_WIDGET_TYPE_ID,
    label: 'Stake Calculator',
    description: 'The interactive TRX stake calculator: energy and bandwidth from a TRX amount, or the TRX needed for a target energy, at live network rates.',
    category: 'Tools',
    defaultDataFetcher: async () => ({}),
    configSchema: { type: 'object', properties: {}, additionalProperties: false },
    embeddable: true
};
