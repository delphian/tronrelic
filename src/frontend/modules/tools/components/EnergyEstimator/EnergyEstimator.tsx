/**
 * @fileoverview Energy estimator tool page.
 *
 * Estimates daily energy requirements based on contract type and usage patterns,
 * and compares staking for that energy with burning TRX for it. The cost figures
 * are burn costs at the chain's energy fee, not rental prices, and are labelled
 * that way. User-triggered action — loading state is appropriate.
 */
'use client';

import { useState } from 'react';
import { Zap } from 'lucide-react';
import { Page, PageHeader, Stack, Grid } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { Badge } from '../../../../components/ui/Badge';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { estimateEnergy } from '../../api/client';
import type { IEnergyEstimate } from '../../types';
import styles from './EnergyEstimator.module.scss';

/**
 * Energy estimator tool.
 *
 * Users specify a contract type, average method calls, and daily transaction
 * count. The tool returns energy requirements, the stake that covers them, and
 * what burning TRX for that energy costs instead. Renting is not priced here,
 * because core holds no market data, and the note under the figures says so.
 */
export function EnergyEstimator() {
    const [contractType, setContractType] = useState('TriggerSmartContract');
    const [methodCalls, setMethodCalls] = useState('1');
    const [txPerDay, setTxPerDay] = useState('10');
    const [result, setResult] = useState<IEnergyEstimate | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation();

    /** Confidence levels the backend reports, shown in the visitor's language. */
    const confidenceLabels: Record<string, string> = {
        high: t('tools.energyEstimator.confidence.high', 'high'),
        medium: t('tools.energyEstimator.confidence.medium', 'medium'),
        low: t('tools.energyEstimator.confidence.low', 'low')
    };

    /** Submit estimation request. */
    const handleEstimate = async () => {
        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const data = await estimateEnergy(contractType, Number(methodCalls), Number(txPerDay));
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('tools.energyEstimator.error.failed', 'Estimation failed'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <Page>
            <PageHeader
                title={t('tools.energyEstimator.title', 'Energy Estimator')}
                subtitle={t('tools.energyEstimator.subtitle', 'Estimate daily energy requirements and compare staking with burning TRX for fees')}
            />
            <Card>
                <Stack gap="md">
                    <Grid columns="responsive" gap="md">
                        <div>
                            <label className={styles.label} htmlFor="contract-type">{t('tools.energyEstimator.contractType', 'Contract Type')}</label>
                            <Input
                                id="contract-type"
                                value={contractType}
                                onChange={e => setContractType(e.target.value)}
                                placeholder={t('tools.energyEstimator.contractTypePlaceholder', 'e.g., {example}', { example: 'TriggerSmartContract' })}
                            />
                        </div>
                        <div>
                            <label className={styles.label} htmlFor="method-calls">{t('tools.energyEstimator.methodCalls', 'Avg Method Calls / TX')}</label>
                            <Input
                                id="method-calls"
                                type="number"
                                min="1"
                                value={methodCalls}
                                onChange={e => setMethodCalls(e.target.value)}
                            />
                        </div>
                        <div>
                            <label className={styles.label} htmlFor="tx-per-day">{t('tools.energyEstimator.txPerDay', 'Transactions / Day')}</label>
                            <Input
                                id="tx-per-day"
                                type="number"
                                min="1"
                                value={txPerDay}
                                onChange={e => setTxPerDay(e.target.value)}
                            />
                        </div>
                    </Grid>
                    <Button variant="primary" onClick={handleEstimate} disabled={loading} loading={loading}>
                        <Zap size={18} />
                        {t('tools.energyEstimator.submit', 'Estimate Energy')}
                    </Button>

                    {error && <p className={styles.error}>{error}</p>}

                    {result && (
                        <div className={styles.results}>
                            <div className={styles.stat_grid}>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.energyEstimator.requiredEnergy', 'Required Energy')}</span>
                                    <span className={styles.stat__value}>{result.requiredEnergy.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.energyEstimator.recommendedStake', 'Recommended Stake')}</span>
                                    <span className={styles.stat__value}>{result.recommendedStake.toLocaleString()} TRX</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.energyEstimator.burnCostDay', 'Burn Cost / Day')}</span>
                                    <span className={styles.stat__value}>{result.burnCostPerDayTRX.toLocaleString()} TRX</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.energyEstimator.burnCostMonth', 'Burn Cost / Month')}</span>
                                    <span className={styles.stat__value}>{result.burnCostPerMonthTRX.toLocaleString()} TRX</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.energyEstimator.burnEqualsStake', 'Burn Equals Stake After')}</span>
                                    <span className={styles.stat__value}>
                                        {result.burnMatchesStakeDays != null
                                            ? t('tools.energyEstimator.days', '{count} days', { count: result.burnMatchesStakeDays })
                                            : t('tools.energyEstimator.notApplicable', 'N/A')}
                                    </span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.energyEstimator.confidenceLabel', 'Confidence')}</span>
                                    <Badge tone={result.confidence === 'high' ? 'success' : result.confidence === 'medium' ? 'warning' : 'danger'}>
                                        {t('tools.energyEstimator.confidenceValue', '{level} ({count} samples)', {
                                            level: confidenceLabels[result.confidence] ?? result.confidence,
                                            count: result.sampleSize
                                        })}
                                    </Badge>
                                </div>
                            </div>
                            <p className="text-muted">
                                {t(
                                    'tools.energyEstimator.burnNote',
                                    'Burn cost is the TRX the network burns, at {sun} SUN per unit, when an account has no staked or rented energy. Staked TRX is locked rather than spent and can be unstaked later. Renting energy from a market usually costs less than burning.',
                                    { sun: result.burnPriceSun.toLocaleString() }
                                )}
                            </p>
                        </div>
                    )}
                </Stack>
            </Card>
        </Page>
    );
}
