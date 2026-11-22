/**
 * @fileoverview Widget-type registration for the embeddable staking rewards calculator.
 *
 * Registering the calculator as a widget type lets a CMS page embed it with a
 * ` ```widget ` block, which is how the proposed staking rewards page places
 * the calculator inside editable text. The frontend renders it with the
 * component keyed on the same id in `widgets.core.ts`.
 *
 * - The fetcher returns the stored rewards snapshot, so the representative
 *   table renders on the server with real figures and no loading state.
 * - It takes no settings, so it declares an empty settings schema.
 * - It renders nothing taken from its settings and nothing specific to the
 *   visitor, so it is safe to embed in a page any author can propose.
 */

import type { IRegisterWidgetTypeInput, IStakingRewardsSnapshot } from '@/types';
import { STAKING_REWARDS_WIDGET_TYPE_ID } from '@/types';

/**
 * What the widget's fetcher hands the frontend component.
 */
export interface IStakingRewardsWidgetData {
    /** The stored snapshot, or null before the first refresh has finished. */
    snapshot: IStakingRewardsSnapshot | null;
}

/**
 * Build the registration input for the staking rewards widget.
 *
 * A factory rather than a constant because the fetcher needs the service that
 * reads the stored snapshot, which exists only after the module's `init()`.
 *
 * @param readSnapshot - Reads the stored snapshot; the service's `getSnapshot`.
 * @returns The input the tools module passes to `IWidgetsService.registerType`.
 */
export function createStakingRewardsWidgetType(
    readSnapshot: () => Promise<IStakingRewardsSnapshot | null>
): IRegisterWidgetTypeInput {
    return {
        id: STAKING_REWARDS_WIDGET_TYPE_ID,
        label: 'Staking Rewards Calculator',
        description: 'The interactive TRX staking rewards calculator: the yearly voting reward through each Super Representative, after its commission, from the latest on-chain figures.',
        category: 'Tools',
        defaultDataFetcher: async (): Promise<IStakingRewardsWidgetData> => ({ snapshot: await readSnapshot() }),
        configSchema: { type: 'object', properties: {}, additionalProperties: false },
        embeddable: true
    };
}
