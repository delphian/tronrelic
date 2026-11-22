/**
 * @fileoverview The staking rewards calculator as a whole page, with its heading.
 *
 * The fixed `/tools/staking-rewards` route renders this when no CMS page is
 * served at that address in the visitor's language. The calculator itself
 * lives in `StakingRewardsCalculator`, which the CMS page embeds as a widget.
 * Keep the heading and intro in step with `STAKING_REWARDS_PAGE_PROPOSAL.ts`.
 */
'use client';

import type { IStakingRewardsSnapshot } from '@/types';
import { Page, PageHeader } from '../../../../components/layout';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { StakingRewardsCalculator } from './StakingRewardsCalculator';

/**
 * Props for {@link StakingRewards}.
 */
interface IStakingRewardsProps {
    /** The stored snapshot read on the server, or null before the first refresh has finished. */
    snapshot: IStakingRewardsSnapshot | null;
}

/**
 * Staking rewards page with its translated title and intro above the calculator.
 *
 * @param props - The server-read snapshot.
 * @returns The page.
 */
export function StakingRewards({ snapshot }: IStakingRewardsProps) {
    const { t } = useTranslation();

    return (
        <Page>
            <PageHeader
                title={t('tools.stakingRewards.title', 'Staking Rewards Calculator')}
                subtitle={t('tools.stakingRewards.subtitle', 'Estimate the TRX you earn each year by voting with staked TRX, through each Super Representative after its commission')}
            />
            <StakingRewardsCalculator snapshot={snapshot} />
        </Page>
    );
}
