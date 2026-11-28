/**
 * @fileoverview The CMS pages the tools module offers to create.
 *
 * Each entry becomes a row with a Create button on the Bootstrap tab of
 * `/system/tools`. Add an entry here to offer another page; the admin page
 * and the endpoints pick it up with no other change.
 */

import type { IPageBootstrapItem } from '@/types';
import { STAKE_CALCULATOR_PAGE_PROPOSAL } from './STAKE_CALCULATOR_PAGE_PROPOSAL.js';
import { STAKING_REWARDS_PAGE_PROPOSAL } from './STAKING_REWARDS_PAGE_PROPOSAL.js';
import { ENERGY_ESTIMATOR_PAGE_PROPOSAL } from './ENERGY_ESTIMATOR_PAGE_PROPOSAL.js';
import { TIMESTAMP_CONVERTER_PAGE_PROPOSAL } from './TIMESTAMP_CONVERTER_PAGE_PROPOSAL.js';

/**
 * Pages offered on the Bootstrap tab, in display order.
 */
export const TOOLS_BOOTSTRAP_PAGES: ReadonlyArray<IPageBootstrapItem> = [
    {
        id: 'stake-calculator',
        label: 'Stake Calculator page',
        description: 'The page at the stake calculator\'s address, with the calculator embedded as a required widget. No built-in page serves this address, so it answers 404 until this page is approved.',
        proposal: STAKE_CALCULATOR_PAGE_PROPOSAL
    },
    {
        id: 'staking-rewards',
        label: 'Staking Rewards Calculator page',
        description: 'The page at the staking rewards calculator\'s address, with the calculator embedded as a required widget. No built-in page serves this address, so it answers 404 until this page is approved.',
        proposal: STAKING_REWARDS_PAGE_PROPOSAL
    },
    {
        id: 'energy-estimator',
        label: 'Energy Estimator page',
        description: 'The page at the energy estimator\'s address, with the estimator embedded as a required widget. No built-in page serves this address, so it answers 404 until this page is approved.',
        proposal: ENERGY_ESTIMATOR_PAGE_PROPOSAL
    },
    {
        id: 'timestamp-converter',
        label: 'Timestamp Converter page',
        description: 'The page at the timestamp converter\'s address, with the converter embedded as a required widget. No built-in page serves this address, so it answers 404 until this page is approved.',
        proposal: TIMESTAMP_CONVERTER_PAGE_PROPOSAL
    }
];
