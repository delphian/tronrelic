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
import { ADDRESS_CONVERTER_PAGE_PROPOSAL } from './ADDRESS_CONVERTER_PAGE_PROPOSAL.js';
import { ADDRESS_GENERATOR_PAGE_PROPOSAL } from './ADDRESS_GENERATOR_PAGE_PROPOSAL.js';
import { SIGNATURE_VERIFIER_PAGE_PROPOSAL } from './SIGNATURE_VERIFIER_PAGE_PROPOSAL.js';
import { APPROVAL_CHECKER_PAGE_PROPOSAL } from './APPROVAL_CHECKER_PAGE_PROPOSAL.js';
import { ADDRESS_ORIGINS_PAGE_PROPOSAL } from './ADDRESS_ORIGINS_PAGE_PROPOSAL.js';

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
    },
    {
        id: 'address-converter',
        label: 'Address Converter page',
        description: 'The page at the address converter\'s address, with the converter embedded as a required widget. No built-in page serves this address, so it answers 404 until this page is approved.',
        proposal: ADDRESS_CONVERTER_PAGE_PROPOSAL
    },
    {
        id: 'address-generator',
        label: 'Address Generator page',
        description: 'The page at the address generator\'s address, with the generator embedded as a required widget. No built-in page serves this address, so it answers 404 until this page is approved.',
        proposal: ADDRESS_GENERATOR_PAGE_PROPOSAL
    },
    {
        id: 'signature-verifier',
        label: 'Signature Verifier page',
        description: 'The page at the signature verifier\'s address, with the verifier embedded as a required widget. No built-in page serves this address, so it answers 404 until this page is approved.',
        proposal: SIGNATURE_VERIFIER_PAGE_PROPOSAL
    },
    {
        id: 'approval-checker',
        label: 'Approval Checker page',
        description: 'The page at the approval checker\'s address, with the checker embedded as a required widget. No built-in page serves this address, so it answers 404 until this page is approved.',
        proposal: APPROVAL_CHECKER_PAGE_PROPOSAL
    },
    {
        id: 'address-origins',
        label: 'Address Origins page',
        description: 'The page at Address Origins\' address, with the tracer embedded as a required widget. No built-in page serves this address, so it answers 404 until this page is approved.',
        proposal: ADDRESS_ORIGINS_PAGE_PROPOSAL
    }
];
