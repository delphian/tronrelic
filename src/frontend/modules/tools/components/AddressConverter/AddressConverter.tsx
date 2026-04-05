/**
 * @fileoverview Address converter tool page.
 *
 * Converts between TRON hex (41-prefixed) and base58check (T-prefixed) formats.
 * Accepts input in either format and displays both representations.
 * User-triggered action — loading state is appropriate here.
 */
'use client';

import { useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Page, PageHeader, Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { convertAddress } from '../../api/client';
import type { IAddressConversionResult } from '../../types';
import styles from './AddressConverter.module.scss';

/**
 * Address converter tool.
 *
 * Users paste a TRON address in either hex or base58check format and
 * receive both representations. No SSR data needed — purely interactive.
 */
export function AddressConverter() {
    const [input, setInput] = useState('');
    const [result, setResult] = useState<IAddressConversionResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);

    /** Determine format and submit to the API. */
    const handleConvert = async () => {
        const trimmed = input.trim();
        if (!trimmed) return;

        setLoading(true);
        setError(null);
        setResult(null);

        try {
            const isHex = /^(0x)?41[0-9a-fA-F]{40}$/u.test(trimmed) || /^(0x)?[0-9a-fA-F]{40}$/u.test(trimmed);
            const payload = isHex ? { hex: trimmed } : { base58Check: trimmed };
            const data = await convertAddress(payload);
            setResult(data);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Invalid address format');
        } finally {
            setLoading(false);
        }
    };

    return (
        <Page>
            <PageHeader title="Address Converter" subtitle="Convert between TRON hex and base58check formats" />
            <div className={styles.container}>
            <Card>
                <Stack gap="md">
                    <label className={styles.label} htmlFor="address-input">
                        TRON Address (hex or base58check)
                    </label>
                    <div className={styles.input_row}>
                        <Input
                            id="address-input"
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder="T... or 41..."
                            onKeyDown={e => e.key === 'Enter' && handleConvert()}
                        />
                        <Button
                            variant="primary"
                            onClick={handleConvert}
                            disabled={loading || !input.trim()}
                            loading={loading}
                        >
                            <ArrowLeftRight size={18} />
                            Convert
                        </Button>
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    {result && (
                        <div className={styles.result}>
                            <div className={styles.result__field}>
                                <span className={styles.result__label}>Base58Check</span>
                                <code className={styles.result__value}>{result.base58check}</code>
                            </div>
                            <div className={styles.result__field}>
                                <span className={styles.result__label}>Hex</span>
                                <code className={styles.result__value}>{result.hex}</code>
                            </div>
                        </div>
                    )}
                </Stack>
            </Card>
            </div>
        </Page>
    );
}
