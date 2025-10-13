'use client';

import type { IFrontendPluginContext } from '@tronrelic/types';
import type { IWhaleAlertsConfig } from '../../../shared/types';

interface WhaleThresholdSettingsProps {
    config: IWhaleAlertsConfig;
    onChange: (config: IWhaleAlertsConfig) => void;
    context: IFrontendPluginContext;
}

/**
 * Whale Threshold Settings Component.
 *
 * Provides controls for adjusting the TRX threshold that determines when a
 * transaction is classified as a whale transaction. Uses the injected UI
 * components from the frontend plugin context for consistency.
 *
 * @param props - Component props
 * @param props.config - Current whale alerts configuration
 * @param props.onChange - Callback when configuration changes
 * @param props.context - Frontend plugin context with UI components
 */
export function WhaleThresholdSettings({ config, onChange, context }: WhaleThresholdSettingsProps) {
    const { ui } = context;

    const handleThresholdChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = parseInt(e.target.value, 10);
        if (!isNaN(value) && value >= 0) {
            onChange({ ...config, thresholdTRX: value });
        }
    };

    const formatNumber = (value: number): string => {
        return new Intl.NumberFormat('en-US').format(value);
    };

    return (
        <ui.Card>
            <div className="whale-admin-section">
                <div className="whale-admin-section__header">
                    <h3 className="whale-admin-section__title">Detection Threshold</h3>
                    <p className="whale-admin-section__description">
                        Set the minimum TRX transfer amount required for a transaction to be
                        classified as whale activity. Higher thresholds reduce noise from smaller
                        transactions.
                    </p>
                </div>

                <div className="whale-admin-section__content">
                    <div className="form-group">
                        <label htmlFor="threshold-trx" className="form-label">
                            Minimum TRX Amount
                        </label>
                        <ui.Input
                            id="threshold-trx"
                            type="number"
                            value={config.thresholdTRX}
                            onChange={handleThresholdChange}
                            min={0}
                            step={10000}
                        />
                        <p className="form-help">
                            Current threshold: <strong>{formatNumber(config.thresholdTRX)} TRX</strong>
                        </p>
                    </div>

                    <div className="whale-threshold-examples">
                        <h4 className="whale-threshold-examples__title">Common Thresholds</h4>
                        <div className="whale-threshold-examples__list">
                            <button
                                type="button"
                                onClick={() => onChange({ ...config, thresholdTRX: 250_000 })}
                                className="whale-threshold-example"
                            >
                                <span className="whale-threshold-example__value">250,000 TRX</span>
                                <span className="whale-threshold-example__label">Small Whales</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange({ ...config, thresholdTRX: 500_000 })}
                                className="whale-threshold-example"
                            >
                                <span className="whale-threshold-example__value">500,000 TRX</span>
                                <span className="whale-threshold-example__label">Medium Whales</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange({ ...config, thresholdTRX: 1_000_000 })}
                                className="whale-threshold-example"
                            >
                                <span className="whale-threshold-example__value">1,000,000 TRX</span>
                                <span className="whale-threshold-example__label">Large Whales</span>
                            </button>
                            <button
                                type="button"
                                onClick={() => onChange({ ...config, thresholdTRX: 5_000_000 })}
                                className="whale-threshold-example"
                            >
                                <span className="whale-threshold-example__value">5,000,000 TRX</span>
                                <span className="whale-threshold-example__label">Mega Whales</span>
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </ui.Card>
    );
}
