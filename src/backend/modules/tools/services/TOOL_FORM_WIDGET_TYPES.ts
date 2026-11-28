/**
 * @fileoverview The tools that are only a form, registered as embeddable widgets.
 *
 * Each tool here is the widget its CMS page embeds: the stake calculator, the
 * energy estimator, and the timestamp converter. None of them needs server
 * data, so they share one registration shape from `createToolFormWidgetType`.
 * The staking rewards calculator is not here, because its fetcher reads the
 * stored rewards snapshot. Add a form tool to this list to register it; the
 * module registers every entry in `run()`.
 */

import type { IRegisterWidgetTypeInput } from '@/types';
import {
    ENERGY_ESTIMATOR_WIDGET_TYPE_ID,
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
    )
];
