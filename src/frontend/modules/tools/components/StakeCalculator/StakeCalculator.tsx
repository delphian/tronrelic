/**
 * @fileoverview Bidirectional stake calculator tool page.
 *
 * Calculates energy and bandwidth from a TRX stake amount (forward), or
 * TRX required to produce a target energy amount (reverse). Filling either
 * field triggers the calculation using live network parameters.
 */
'use client';

import { useState } from 'react';
import { Calculator } from 'lucide-react';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { estimateStakeFromTrx, estimateStakeFromEnergy } from '../../api/client';
import type { IStakeEstimate } from '../../types';
import styles from './StakeCalculator.module.scss';

/**
 * Bidirectional stake calculator.
 *
 * Users can fill in either TRX or Energy — the other field calculates
 * automatically using the current network ratio. Both directions call
 * the backend to use live TronGrid parameters.
 */
export function StakeCalculator() {
    const [trxInput, setTrxInput] = useState('');
    const [energyInput, setEnergyInput] = useState('');
    const [result, setResult] = useState<IStakeEstimate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    /** Calculate from TRX amount. */
    const handleFromTrx = async () => {
        const trx = Number(trxInput);
        if (!trx || trx < 1) return;

        setLoading(true);
        setError(null);
        try {
            const data = await estimateStakeFromTrx(trx);
            setResult(data);
            setEnergyInput(String(Math.round(data.energy)));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Calculation failed');
        } finally {
            setLoading(false);
        }
    };

    /** Calculate from energy target. */
    const handleFromEnergy = async () => {
        const energy = Number(energyInput);
        if (!energy || energy < 1) return;

        setLoading(true);
        setError(null);
        try {
            const data = await estimateStakeFromEnergy(energy);
            setResult(data);
            setTrxInput(String(data.trx));
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Calculation failed');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Page>
            <PageHeader title="Stake Calculator" subtitle="Calculate energy from TRX or TRX from energy using live network parameters" />
            <div className={styles.container}>
            <Card>
                <Stack gap="md">
                    <div className={styles.fields}>
                        <div className={styles.field_group}>
                            <label className={styles.label} htmlFor="trx-input">TRX to Stake</label>
                            <div className={styles.input_row}>
                                <Input
                                    id="trx-input"
                                    type="number"
                                    min="1"
                                    value={trxInput}
                                    onChange={e => setTrxInput(e.target.value)}
                                    placeholder="Enter TRX amount"
                                    onKeyDown={e => e.key === 'Enter' && handleFromTrx()}
                                />
                                <Button variant="primary" onClick={handleFromTrx} disabled={loading || !trxInput} loading={loading}>
                                    <Calculator size={18} />
                                    Calculate
                                </Button>
                            </div>
                        </div>

                        <div className={styles.divider}>
                            <span className={styles.divider__text}>or</span>
                        </div>

                        <div className={styles.field_group}>
                            <label className={styles.label} htmlFor="energy-input">Target Energy</label>
                            <div className={styles.input_row}>
                                <Input
                                    id="energy-input"
                                    type="number"
                                    min="1"
                                    value={energyInput}
                                    onChange={e => setEnergyInput(e.target.value)}
                                    placeholder="Enter energy amount"
                                    onKeyDown={e => e.key === 'Enter' && handleFromEnergy()}
                                />
                                <Button variant="primary" onClick={handleFromEnergy} disabled={loading || !energyInput} loading={loading}>
                                    <Calculator size={18} />
                                    Calculate
                                </Button>
                            </div>
                        </div>
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    {result && (
                        <div className={styles.results}>
                            <div className={styles.stat_grid}>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>TRX Required</span>
                                    <span className={styles.stat__value}>{result.trx.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>Energy</span>
                                    <span className={styles.stat__value}>{result.energy.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>Bandwidth</span>
                                    <span className={styles.stat__value}>{result.bandwidth.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>Energy / TRX</span>
                                    <span className={styles.stat__value}>{result.energyPerTrx}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>Bandwidth / TRX</span>
                                    <span className={styles.stat__value}>{result.bandwidthPerTrx}</span>
                                </div>
                            </div>
                        </div>
                    )}
                </Stack>
            </Card>
            </div>
        </Page>
    );
}
