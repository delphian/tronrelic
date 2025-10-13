'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { estimateEnergy, type EnergyEstimateRequest, type EnergyEstimateResult } from '../../../../lib/api';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { useToast } from '../../../../components/ui/ToastProvider';
import styles from './PriceCalculator.module.css';

type FormState = EnergyEstimateRequest;

const initialState: FormState = {
    contractAddress: '',
    fromAddress: '',
    toAddress: '',
    amount: ''
};

/**
 * Renders an interactive TRON energy fee calculator that estimates the energy cost for TRC20 token transfers.
 *
 * This form component accepts contract addresses, transfer amounts, and optional sender/receiver addresses,
 * then queries the backend API to retrieve energy consumption estimates for both success and failure scenarios.
 * It supports URL-based prefilling via query parameters and displays popular contract shortcuts for quick access.
 *
 * @returns The energy calculator form with results display and quick-select contract shortcuts
 */
export function PriceCalculator() {
    const params = useSearchParams();
    const { push } = useToast();
    const [form, setForm] = useState<FormState>(initialState);
    const [loading, setLoading] = useState(false);
    const [result, setResult] = useState<EnergyEstimateResult | null>(null);

    /**
     * Submits the energy estimation request to the backend API.
     * Validates that required fields (contract address and amount) are present before making the API call.
     * Displays toast notifications for success, warnings, and errors.
     *
     * @param state - Optional form state to submit (defaults to current form state)
     */
    const handleSubmit = useCallback(async (state?: FormState) => {
        const payload = state ?? form;
        if (!payload.amount || !payload.contractAddress) {
            push({
                tone: 'warning',
                title: 'Incomplete details',
                description: 'Enter a contract address and amount to estimate energy.'
            });
            return;
        }

        setLoading(true);
        try {
            const estimate = await estimateEnergy(payload);
            setResult(estimate);
            if (estimate.message) {
                push({
                    tone: 'warning',
                    title: 'Potential issue detected',
                    description: estimate.message
                });
            } else {
                push({
                    tone: 'success',
                    title: 'Energy estimate ready',
                    description: 'Review the expected usage for success and failure scenarios.'
                });
            }
        } catch (error) {
            console.error('Energy estimate failed', error);
            push({
                tone: 'danger',
                title: 'Unable to estimate energy',
                description: error instanceof Error ? error.message : 'Unexpected error from calculator.'
            });
        } finally {
            setLoading(false);
        }
    }, [form, push]);

    /**
     * Automatically prefills form fields from URL query parameters on initial load.
     * If any query parameters are present, triggers an immediate energy estimation.
     */
    useEffect(() => {
        if (!params) {
            return;
        }

        const prefilled: FormState = {
            contractAddress: params.get('contractAddress') ?? '',
            fromAddress: params.get('fromAddress') ?? '',
            toAddress: params.get('toAddress') ?? '',
            amount: params.get('amount') ?? ''
        };

        const hasPrefill = Object.values(prefilled).some(value => value);
        if (hasPrefill) {
            setForm(prefilled);
            handleSubmit(prefilled).catch(error => {
                console.error('Prefill energy estimate failed', error);
            });
        }
    }, [handleSubmit, params]);

    const isValid = useMemo(() => form.contractAddress && form.amount, [form.contractAddress, form.amount]);

    /**
     * Creates a change handler for a specific form field.
     *
     * @param field - The form field key to update
     * @returns Event handler that updates the specified form field
     */
    const handleChange = (field: keyof FormState) => (event: React.ChangeEvent<HTMLInputElement>) => {
        setForm(prev => ({
            ...prev,
            [field]: event.target.value
        }));
    };

    return (
        <Card padding="lg">
            <div className="stack" style={{ gap: '1.5rem' }}>
                <header className={`stack stack--sm ${styles.header}`}>
                    <h2 className={styles.header__title}>TRON Energy Fee Calculator</h2>
                    <p className={`text-subtle ${styles.header__description}`}>
                        Estimate the energy required for TRC20 transfers. Results include both success and failure scenarios to match
                        the legacy calculator.
                    </p>
                </header>

                <section className={`stack stack--sm ${styles.form_section}`}>
                    <div className={styles.form_grid}>
                        <Input
                            placeholder="Contract address"
                            value={form.contractAddress}
                            onChange={handleChange('contractAddress')}
                            required
                        />
                        <Input
                            placeholder="Amount"
                            value={form.amount}
                            onChange={handleChange('amount')}
                            required
                        />
                    </div>
                    <div className={styles.form_grid}>
                        <Input
                            placeholder="From address (optional)"
                            value={form.fromAddress}
                            onChange={handleChange('fromAddress')}
                        />
                        <Input
                            placeholder="To address (optional)"
                            value={form.toAddress}
                            onChange={handleChange('toAddress')}
                        />
                    </div>
                    <div className={styles.form_actions}>
                        <Button onClick={() => handleSubmit()} loading={loading} disabled={!isValid || loading}>
                            {loading ? 'Calculating…' : 'Estimate energy'}
                        </Button>
                    </div>
                </section>

                {result && (
                    <section className={`surface surface--padding-md ${styles.results}`}>
                        <div className="stack stack--sm">
                            <h3 className={styles.results__title}>Results</h3>
                            <article className={styles.results__grid}>
                                <ResultMetric
                                    label="Energy used (failure)"
                                    value={result.energyUsed.toLocaleString()}
                                    tone="warning"
                                    helper="Max energy consumption if the transaction fails."
                                />
                                <ResultMetric
                                    label="Energy used (success)"
                                    value={(result.energyUsed - result.energyPenalty).toLocaleString()}
                                    tone="success"
                                    helper="Expected consumption on successful execution."
                                />
                                <ResultMetric
                                    label="Energy penalty"
                                    value={result.energyPenalty.toLocaleString()}
                                    tone="danger"
                                    helper="Difference between failure and success paths."
                                />
                            </article>
                            {result.message && (
                                <div className="alert alert--warning">
                                    <strong>Heads up:</strong> {result.message}
                                </div>
                            )}
                        </div>
                    </section>
                )}

                <footer className={`stack stack--sm ${styles.footer}`}>
                    <h4 className={styles.footer__title}>Popular contracts</h4>
                    <div className={styles.shortcuts_grid}>
                        <Shortcut label="USDT" address="TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t" onSelect={value => setForm(prev => ({ ...prev, contractAddress: value }))} />
                        <Shortcut label="USDD" address="TNzsbr98vrDiiGX8RLKeQ1Qy8DMdM8wExf" onSelect={value => setForm(prev => ({ ...prev, contractAddress: value }))} />
                        <Shortcut label="SUN" address="TFs6mEDLJrb8FEbDuwN6fEDvVguZcY1zwV" onSelect={value => setForm(prev => ({ ...prev, contractAddress: value }))} />
                    </div>
                </footer>
            </div>
        </Card>
    );
}

/**
 * Displays a single energy consumption metric with a colored indicator and helper text.
 *
 * @param label - The metric label (e.g., "Energy used (success)")
 * @param value - The formatted numeric value to display
 * @param helper - Explanatory text describing the metric's meaning
 * @param tone - Visual tone indicator ('success', 'warning', 'danger')
 * @returns A styled metric card with left border accent
 */
function ResultMetric({ label, value, helper, tone }: { label: string; value: string; helper: string; tone: 'success' | 'warning' | 'danger' }) {
    return (
        <div className={`${styles.metric} ${styles[`metric--${tone}`]}`}>
            <div className={`text-subtle ${styles.metric__label}`}>{label}</div>
            <strong className={styles.metric__value}>{value}</strong>
            <p className={`text-subtle ${styles.metric__helper}`}>{helper}</p>
        </div>
    );
}

/**
 * Renders a clickable chip for quickly selecting a popular TRC20 token contract address.
 *
 * @param label - The token symbol (e.g., "USDT")
 * @param address - The full TRC20 contract address
 * @param onSelect - Callback invoked when the chip is clicked, receives the full address
 * @returns A chip button displaying the token symbol and truncated address
 */
function Shortcut({ label, address, onSelect }: { label: string; address: string; onSelect: (address: string) => void }) {
    return (
        <button
            type="button"
            className={`chip ${styles.shortcut}`}
            onClick={() => onSelect(address)}
        >
            <span>{label}</span>
            <span className={styles.shortcut__address}>{address.slice(0, 6)}…{address.slice(-6)}</span>
        </button>
    );
}
