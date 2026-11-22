/**
 * @fileoverview Widget renderer for the embeddable staking rewards calculator.
 *
 * The tools module registers the calculator as the `tools:staking-rewards`
 * widget type so a CMS page can place it inside its text with a ` ```widget `
 * block. The widget registry in `widgets.core.ts` maps that id to this
 * component. The widget's server-side fetcher sends the stored rewards
 * snapshot as `data.snapshot`, so the table renders in the page's first HTML.
 *
 * The file is a client module, as every widget component must be: a CMS page
 * hands each widget's component to the client-side `WidgetWithContext`, and
 * React can pass a component across that boundary only when its module is
 * marked `'use client'`.
 */
'use client';

import type { IStakingRewardsSnapshot, IWidgetComponentProps } from '@/types';
import { StakingRewardsCalculator } from './StakingRewardsCalculator';

/**
 * Read the snapshot out of the widget's server data, treating anything
 * malformed as "no snapshot yet" so a bad payload shows the notice rather
 * than breaking the page.
 *
 * @param data - The widget's `data` prop.
 * @returns The snapshot, or null.
 */
function readSnapshot(data: unknown): IStakingRewardsSnapshot | null {
    const snapshot = (data as { snapshot?: IStakingRewardsSnapshot | null } | null)?.snapshot;

    return snapshot && Array.isArray(snapshot.representatives) ? snapshot : null;
}

/**
 * Render the calculator inside a page body, without page chrome, so the
 * surrounding CMS text supplies the heading.
 *
 * @param props - Widget props carrying the server-read snapshot.
 * @returns The staking rewards calculator.
 */
export function StakingRewardsWidget({ data }: IWidgetComponentProps) {
    return <StakingRewardsCalculator snapshot={readSnapshot(data)} />;
}
