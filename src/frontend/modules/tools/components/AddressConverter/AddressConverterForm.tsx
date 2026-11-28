/**
 * @fileoverview The address converter's form and result, without page chrome.
 *
 * The converter is served inside a CMS page body as the
 * `tools:address-converter` widget, and the CMS page supplies the heading and
 * text around it, so this component draws no page header of its own.
 *
 * Converts between TRON hex (41-prefixed) and base58check (T-prefixed) formats.
 * Accepts input in either format and displays both representations.
 * User-triggered action — loading state is appropriate here.
 */
'use client';

import { useId, useState } from 'react';
import { ArrowLeftRight } from 'lucide-react';
import { Stack } from '../../../../components/layout';
import { Card } from '../../../../components/ui/Card';
import { Input } from '../../../../components/ui/Input';
import { Button } from '../../../../components/ui/Button';
import { useTranslation } from '../../../localization/hooks/useTranslation';
import { convertAddress } from '../../api/client';
import type { IAddressConversionResult } from '../../types';
import styles from './AddressConverter.module.scss';

/** Props for {@link AddressConverterForm}. */
interface IAddressConverterFormProps {
    /**
     * Address to start the field with. The address chip menu links here with
     * an `?address=` value, and the widget passes it in so the field arrives
     * filled. Read once, so it never overwrites what the visitor types.
     */
    initialAddress?: string;
}

/**
 * Address converter form.
 *
 * Users paste a TRON address in either hex or base58check format and
 * receive both representations. Nothing is shown until the visitor converts,
 * so the server renders the form and the loading state belongs to a user action.
 *
 * @param props - Component props.
 * @param props.initialAddress - Address the field starts with, if the page link carried one.
 * @returns The converter card.
 */
export function AddressConverterForm({ initialAddress = '' }: IAddressConverterFormProps) {
    const { t } = useTranslation();
    const [input, setInput] = useState(initialAddress);
    const [result, setResult] = useState<IAddressConversionResult | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    // A page can embed the converter more than once, so each instance needs
    // its own input id for the label to point at the right field.
    const inputId = useId();

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
            setError(err instanceof Error ? err.message : t('tools.addressConverter.error.invalidFormat', 'Invalid address format'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className={styles.container}>
            <Card>
                <Stack gap="md">
                    <label className={styles.label} htmlFor={inputId}>
                        {t('tools.addressConverter.inputLabel', 'TRON Address (hex or base58check)')}
                    </label>
                    <div className={styles.input_row}>
                        <Input
                            id={inputId}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            placeholder={t('tools.addressConverter.inputPlaceholder', 'T... or 41...')}
                            onKeyDown={e => e.key === 'Enter' && handleConvert()}
                        />
                        <Button
                            variant="primary"
                            onClick={handleConvert}
                            disabled={loading || !input.trim()}
                            loading={loading}
                        >
                            <ArrowLeftRight size={18} />
                            {t('tools.addressConverter.convert', 'Convert')}
                        </Button>
                    </div>

                    {error && <p className={styles.error}>{error}</p>}

                    {result && (
                        <div className={styles.result}>
                            <div className={styles.result__field}>
                                <span className={styles.result__label}>{t('tools.addressConverter.result.base58check', 'Base58Check')}</span>
                                <code className={styles.result__value}>{result.base58check}</code>
                            </div>
                            <div className={styles.result__field}>
                                <span className={styles.result__label}>{t('tools.addressConverter.result.hex', 'Hex')}</span>
                                <code className={styles.result__value}>{result.hex}</code>
                            </div>
                        </div>
                    )}
                </Stack>
            </Card>
        </div>
    );
}
