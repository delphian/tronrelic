/**
 * @fileoverview The CMS pages the tools module offers to create.
 *
 * Each entry becomes a row with a Create button on the Bootstrap tab of
 * `/system/tools`. Add an entry here to offer another page; the admin page
 * and the endpoints pick it up with no other change.
 */

import type { IToolsBootstrapItem } from './IToolsBootstrapItem.js';
import { STAKE_CALCULATOR_PAGE_PROPOSAL } from './STAKE_CALCULATOR_PAGE_PROPOSAL.js';
import { STAKING_REWARDS_PAGE_PROPOSAL } from './STAKING_REWARDS_PAGE_PROPOSAL.js';

/**
 * Pages offered on the Bootstrap tab, in display order.
 */
export const TOOLS_BOOTSTRAP_PAGES: ReadonlyArray<IToolsBootstrapItem> = [
    {
        id: 'stake-calculator',
        label: 'Stake Calculator page',
        description: 'An editable page at the stake calculator\'s address, with the calculator embedded as a widget. Until it is approved, the built-in calculator page stays in place.',
        proposal: STAKE_CALCULATOR_PAGE_PROPOSAL
    },
    {
        id: 'staking-rewards',
        label: 'Staking Rewards Calculator page',
        description: 'An editable page at the staking rewards calculator\'s address, with the calculator embedded as a widget. Until it is approved, the built-in calculator page stays in place.',
        proposal: STAKING_REWARDS_PAGE_PROPOSAL
    }
];
