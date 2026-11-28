/**
 * @fileoverview The tools that are only a form, registered as embeddable widgets.
 *
 * Each tool here is the widget its CMS page embeds: the stake calculator, the
 * energy estimator, the timestamp converter, the address converter, the
 * address generator, the signature verifier, the approval checker, and
 * Address Origins. None of them needs server data, so they share one
 * registration shape from `createToolFormWidgetType`.
 * The staking rewards calculator is not here, because its fetcher reads the
 * stored rewards snapshot. Add a form tool to this list to register it; the
 * module registers every entry in `run()`.
 */

import type { IRegisterWidgetTypeInput } from '@/types';
import {
    ADDRESS_CONVERTER_WIDGET_TYPE_ID,
    ADDRESS_GENERATOR_WIDGET_TYPE_ID,
    ADDRESS_ORIGINS_WIDGET_TYPE_ID,
    APPROVAL_CHECKER_WIDGET_TYPE_ID,
    ENERGY_ESTIMATOR_WIDGET_TYPE_ID,
    SIGNATURE_VERIFIER_WIDGET_TYPE_ID,
    STAKE_CALCULATOR_WIDGET_TYPE_ID,
    TIMESTAMP_CONVERTER_WIDGET_TYPE_ID
} from '@/types';
import { createToolFormWidgetType } from './createToolFormWidgetType.js';

/**
 * Registration inputs the tools module passes to `IWidgetsService.registerType`.
 */
export const TOOL_FORM_WIDGET_TYPES: ReadonlyArray<IRegisterWidgetTypeInput> = [
    createToolFormWidgetType(
        STAKE_CALCULATOR_WIDGET_TYPE_ID,
        'Stake Calculator',
        'The interactive TRX stake calculator: energy and bandwidth from a TRX amount, or the TRX needed for a target energy, at live network rates.'
    ),
    createToolFormWidgetType(
        ENERGY_ESTIMATOR_WIDGET_TYPE_ID,
        'Energy Estimator',
        'The interactive energy estimator: daily energy for a contract type and transaction count, the stake that covers it, and the TRX burned without one.'
    ),
    createToolFormWidgetType(
        TIMESTAMP_CONVERTER_WIDGET_TYPE_ID,
        'Timestamp Converter',
        'The interactive timestamp converter: a Unix timestamp, a date, or a TRON block number, converted to the other two.'
    ),
    createToolFormWidgetType(
        ADDRESS_CONVERTER_WIDGET_TYPE_ID,
        'Address Converter',
        'The interactive address converter: a TRON address in Base58 or hex form, shown in both. Pre-fills from an ?address= value in the page link.'
    ),
    createToolFormWidgetType(
        ADDRESS_GENERATOR_WIDGET_TYPE_ID,
        'Address Generator',
        'The interactive address generator: a new wallet with a recovery phrase, or a vanity address search. Keys are generated in the visitor\'s browser and never sent anywhere.'
    ),
    createToolFormWidgetType(
        SIGNATURE_VERIFIER_WIDGET_TYPE_ID,
        'Signature Verifier',
        'The interactive signature verifier: checks that a TRON wallet signed a message. A page link carrying ?wallet=, ?message=, and ?signature= fills the form and verifies on load.'
    ),
    createToolFormWidgetType(
        APPROVAL_CHECKER_WIDGET_TYPE_ID,
        'Approval Checker',
        'The interactive token approval checker: a wallet\'s active TRC20 approvals and unlimited allowances. Signed-in visitors only; others see a sign-in note. Pre-fills from an ?address= value in the page link.'
    ),
    createToolFormWidgetType(
        ADDRESS_ORIGINS_WIDGET_TYPE_ID,
        'Address Origins',
        'The interactive activation tracer: follows wallets back through the accounts that activated them, with a reading guide beside the results. Pre-fills from an ?address= value in the page link.'
    )
];
