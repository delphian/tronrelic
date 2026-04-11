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
import { convertTimestamp } from '../../api/client';
import type { ITimestampConversionResult } from '../../types';
import styles from './TimestampConverter.module.scss';

/** Available input type options. */
type InputType = 'timestamp' | 'blockNumber' | 'dateString';

/** Label and placeholder for each input type. */
const INPUT_CONFIG: Record<InputType, { label: string; placeholder: string; type: string }> = {
    timestamp: { label: 'Unix Timestamp (seconds)', placeholder: '1712793600', type: 'number' },
    blockNumber: { label: 'TRON Block Number', placeholder: '70000000', type: 'number' },
    dateString: { label: 'Date (ISO 8601)', placeholder: '2025-04-10T12:00:00Z', type: 'text' }
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
                    setError(`Invalid ${inputType === 'timestamp' ? 'timestamp' : 'block number'}: must be a non-negative integer`);
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
            setError(err instanceof Error ? err.message : 'Conversion failed');
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
            <PageHeader title="Timestamp Converter" subtitle="Convert between Unix timestamps, dates, and TRON block numbers" />
            <div className={styles.container}>
            <Card>
                <Stack gap="md">
                    <div className={styles.type_selector}>
                        {(Object.keys(INPUT_CONFIG) as InputType[]).map(type => (
                            <button
                                key={type}
                                type="button"
                                className={`${styles.type_button} ${type === inputType ? styles.type_button_active : ''}`}
                                onClick={() => { setInputType(type); setResult(null); setError(null); }}
                            >
                                {INPUT_CONFIG[type].label.split(' (')[0]}
                            </button>
                        ))}
                    </div>

                    <label className={styles.label} htmlFor="timestamp-input">
                        {config.label}
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
                            Convert
                        </Button>
                        <Button variant="secondary" onClick={handleNow}>
                            Now
                        </Button>
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    {result && (
                        <div className={styles.results}>
                            <div className={styles.stat_grid}>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>Unix Timestamp</span>
                                    <span className={styles.stat__value}>{result.timestamp.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>Milliseconds</span>
                                    <span className={styles.stat__value}>{result.timestampMs.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>UTC Date</span>
                                    <span className={styles.stat__value}>{result.dateString}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>
                                        Block Number
                                        {result.blockNumberIsEstimate && (
                                            <span className={styles.estimate_badge}> (estimate)</span>
                                        )}
                                    </span>
                                    <span className={styles.stat__value}>{result.blockNumber.toLocaleString()}</span>
                                </div>
                                <div className={styles.stat}>
                                    <span className={styles.stat__label}>Relative</span>
                                    <span className={styles.stat__value}>{result.relativeTime}</span>
                                </div>
                            </div>

                            <p className={styles.disclaimer}>
                                Block numbers are estimated using a 3-second interval from block #{result.referenceBlock.number.toLocaleString()}.
                                Accuracy decreases for timestamps far from the reference point.
                            </p>
                        </div>
                    )}
                </Stack>
            </Card>
            </div>
        </Page>
    );
}
