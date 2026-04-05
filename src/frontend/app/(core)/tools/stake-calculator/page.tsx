/**
 * @fileoverview Stake calculator tool route.
 *
 * Thin wrapper rendering the StakeCalculator component. No SSR data — the tool
 * is a user-driven interactive form.
 */

import { StakeCalculator } from '../../../../modules/tools';

export default function StakeCalculatorPage() {
    return <StakeCalculator />;
}
