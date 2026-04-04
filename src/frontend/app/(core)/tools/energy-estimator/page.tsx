/**
 * @fileoverview Energy estimator tool route.
 *
 * Thin wrapper rendering the EnergyEstimator component. No SSR data — the tool
 * is a user-driven interactive form.
 */

import { EnergyEstimator } from '../../../../modules/tools';

export default function EnergyEstimatorPage() {
    return <EnergyEstimator />;
}
