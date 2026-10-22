/**
 * @fileoverview Bidirectional timestamp, date, and TRON block number converter.
 *
 * Accepts one of three input types (Unix timestamp, ISO date string, or TRON
 * block number) and converts to all three representations using live network
 * data. Block number estimates use the 3-second interval assumption.
 * User-triggered action — loading state is appropriate here.
 */
'use client';

import { useState } from 'react';
import { Clock } from 'lucide-react';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { convertTimestamp } from '../../api/client';
import { formatRelativeTime } from '../../lib/formatRelativeTime';
import type { ITimestampConversionResult } from '../../types';
import styles from './TimestampConverter.module.scss';

/** Available input type options. */
type InputType = 'timestamp' | 'blockNumber' | 'dateString';

/**
 * Placeholder and input type for each input type. The visible labels are
 * looked up through the translator inside the component, because a
 * module-level constant cannot call the translation hook.
 */
const INPUT_CONFIG: Record<InputType, { placeholder: string; type: string }> = {
    timestamp: { placeholder: '1712793600', type: 'number' },
    blockNumber: { placeholder: '70000000', type: 'number' },
    dateString: { placeholder: '2025-04-10T12:00:00Z', type: 'text' }
};

/**
 * Timestamp converter tool.
 *
 * Users select an input type, enter a value, and receive all three
 * representations (timestamp, date, block number) plus relative time.
 * No SSR data needed — purely interactive.
 */
export function TimestampConverter() {
    const [inputType, setInputType] = useState<InputType>('timestamp');
    const [inputValue, setInputValue] = useState('');
    const [result, setResult] = useState<ITimestampConversionResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const { t } = useTranslation();

    /** Short labels for the input type switch. */
    const tabLabels: Record<InputType, string> = {
        timestamp: t('tools.timestampConverter.tab.timestamp', 'Unix Timestamp'),
        blockNumber: t('tools.timestampConverter.tab.blockNumber', 'TRON Block Number'),
        dateString: t('tools.timestampConverter.tab.dateString', 'Date')
    };

    /** Full field labels, naming the unit or format each input expects. */
    const fieldLabels: Record<InputType, string> = {
        timestamp: t('tools.timestampConverter.field.timestamp', 'Unix Timestamp (seconds)'),
        blockNumber: t('tools.timestampConverter.field.blockNumber', 'TRON Block Number'),
        dateString: t('tools.timestampConverter.field.dateString', 'Date (ISO 8601)')
    };

    /** Build the payload and call the API. */
    const handleConvert = async () => {
        const trimmed = inputValue.trim();
        if (!trimmed) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const payload: Record<string, string | number> = {};
            if (inputType === 'timestamp' || inputType === 'blockNumber') {
                const parsed = Number(trimmed);
                if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
                    setError(inputType === 'timestamp'
                        ? t('tools.timestampConverter.error.invalidTimestamp', 'Invalid timestamp: must be a non-negative integer')
                        : t('tools.timestampConverter.error.invalidBlockNumber', 'Invalid block number: must be a non-negative integer'));
                    setLoading(false);
                    return;
                }
                payload[inputType] = parsed;
            } else {
                payload[inputType] = trimmed;
            }

            const data = await convertTimestamp(payload);
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : t('tools.timestampConverter.error.failed', 'Conversion failed'));
        } finally {
            setLoading(false);
        }
    };

    /** Populate the "Now" timestamp as a convenience. */
    const handleNow = () => {
        setInputType('timestamp');
        setInputValue(String(Math.floor(Date.now() / 1000)));
    };

    const config = INPUT_CONFIG[inputType];

    return (
        <Page>
            <PageHeader
                title={t('tools.timestampConverter.title', 'Timestamp Converter')}
                subtitle={t('tools.timestampConverter.subtitle', 'Convert between Unix timestamps, dates, and TRON block numbers')}
            />
            <div className={styles.container}>
            <Card>
                <Stack gap="md">
                    <div className="segmented-control">
                        {(Object.keys(INPUT_CONFIG) as InputType[]).map(type => (
                            <button
                                key={type}
                                type="button"
                                className={type === inputType ? 'is-active' : undefined}
                                onClick={() => { setInputType(type); setResult(null); setError(null); }}
                            >
                                {tabLabels[type]}
                            </button>
                        ))}
                    </div>

                    <label className={styles.label} htmlFor="timestamp-input">
                        {fieldLabels[inputType]}
                    </label>
                    <div className={styles.input_row}>
                        <Input
                            id="timestamp-input"
                            type={config.type}
                            value={inputValue}
                            onChange={e => setInputValue(e.target.value)}
                            placeholder={config.placeholder}
                            onKeyDown={e => e.key === 'Enter' && handleConvert()}
                        />
                        <Button
                            variant="primary"
                            onClick={handleConvert}
                            disabled={loading || !inputValue.trim()}
                            loading={loading}
                        >
                            <Clock size={18} />
                            {t('tools.timestampConverter.convert', 'Convert')}
                        </Button>
                        <Button variant="secondary" onClick={handleNow}>
                            {t('tools.timestampConverter.now', 'Now')}
                        </Button>
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    {result && (
                        <div className={styles.results}>
                            <div className={styles.stat_grid}>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.timestampConverter.result.timestamp', 'Unix Timestamp')}</span>
                                    <span className={styles.stat__value}>{result.timestamp.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.timestampConverter.result.milliseconds', 'Milliseconds')}</span>
                                    <span className={styles.stat__value}>{result.timestampMs.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.timestampConverter.result.utcDate', 'UTC Date')}</span>
                                    <span className={styles.stat__value}>{result.dateString}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>
                                        {t('tools.timestampConverter.result.blockNumber', 'Block Number')}
                                        {result.blockNumberIsEstimate && (
                                            <span className={styles.estimate_badge}> {t('tools.timestampConverter.result.estimate', '(estimate)')}</span>
                                        )}
                                    </span>
                                    <span className={styles.stat__value}>{result.blockNumber.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>{t('tools.timestampConverter.result.relative', 'Relative')}</span>
                                    {/* Worded here rather than taken from the API's
                                        relativeTime, which the backend writes in
                                        English. A result only exists after a click,
                                        so reading the clock here cannot cause a
                                        hydration mismatch. */}
                                    <span className={styles.stat__value}>{formatRelativeTime(result.timestampMs, Date.now(), t)}</span>
                                </div>
                            </div>

                            <p className={styles.disclaimer}>
                                {t(
                                    'tools.timestampConverter.disclaimer',
                                    'Block numbers are estimated using a 3-second interval from block #{block}. Accuracy decreases for timestamps far from the reference point.',
                                    { block: result.referenceBlock.number.toLocaleString() }
                                )}
                            </p>
                        </div>
                    )}
                </Stack>
            </Card>
            </div>
        </Page>
    );
}
