'use client';

/**
 * @fileoverview TronScan provider configuration section.
 *
 * Lets an operator configure the TronScan provider that backs the local TRX price
 * history (and powers portfolio valuation) entirely from the UI — no env, no
 * restart. The API key is a secret: it loads masked, the input never pre-fills the
 * masked value (so a save can't echo `****` back over the real key), and a Test
 * button runs a live call so the operator can confirm connectivity/credentials.
 * Brief inline docs explain that a key is optional and where to obtain one.
 */

import { useEffect, useState, useCallback, type ChangeEvent } from 'react';
import { Plug, Eye, EyeOff, CheckCircle, AlertCircle, ExternalLink } from 'lucide-react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Switch } from '../../../../../components/ui/Switch';
import { Badge } from '../../../../../components/ui/Badge';
import { Stack } from '../../../../../components/layout';
import {
    getTronScanConfig,
    updateTronScanConfig,
    testTronScan,
    CLEAR_SENTINEL,
    type ITronScanConfigView,
    type TronScanPriceSource,
    type ITronScanTestResult
} from './providers-api';
import styles from '../page.module.scss';

/** Where an operator obtains a TronScan API key (optional). */
const TRONSCAN_KEYS_URL = 'https://docs.tronscan.org/api-endpoints/api-keys';

/**
 * Render and manage the TronScan provider config form.
 *
 * @returns The configuration section.
 */
export function TronScanProviderSection() {
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<ITronScanConfigView | null>(null);
    const [apiKeyInput, setApiKeyInput] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [baseUrl, setBaseUrl] = useState('');
    const [source, setSource] = useState<TronScanPriceSource>('coinmarketcap');
    const [enabled, setEnabled] = useState(true);
    const [saving, setSaving] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ITronScanTestResult | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    /**
     * Seed local form state from a freshly-fetched masked config.
     *
     * @param next - The masked config to apply.
     */
    const applyConfig = useCallback((next: ITronScanConfigView) => {
        setConfig(next);
        setBaseUrl(next.baseUrl);
        setSource(next.priceSource);
        setEnabled(next.enabled);
    }, []);

    useEffect(() => {
        let active = true;
        getTronScanConfig()
            .then((cfg) => {
                if (active) {
                    applyConfig(cfg);
                }
            })
            .catch(() => {
                if (active) {
                    setFeedback({ type: 'error', message: 'Failed to load TronScan config.' });
                }
            })
            .finally(() => {
                if (active) {
                    setLoading(false);
                }
            });
        return () => {
            active = false;
        };
    }, [applyConfig]);

    /**
     * Auto-dismiss a success message after a short delay. Driving this from an effect
     * rather than a per-handler timer guarantees the timeout is cleared on unmount and
     * whenever newer feedback replaces it, so no stale timer fires `setFeedback` after
     * unmount and back-to-back saves can't clear a fresh message early.
     */
    useEffect(() => {
        const timer = feedback?.type === 'success'
            ? setTimeout(() => setFeedback(null), 4000)
            : undefined;
        return () => clearTimeout(timer);
    }, [feedback]);

    /**
     * Persist the form. The API key is sent only when the operator typed a new one;
     * an untouched field leaves the stored key intact.
     */
    const handleSave = useCallback(async () => {
        setSaving(true);
        setFeedback(null);
        setTestResult(null);
        try {
            const updates: { baseUrl: string; priceSource: TronScanPriceSource; enabled: boolean; apiKey?: string } = {
                baseUrl: baseUrl.trim(),
                priceSource: source,
                enabled
            };
            if (apiKeyInput.trim()) {
                updates.apiKey = apiKeyInput.trim();
            }
            const next = await updateTronScanConfig(updates);
            applyConfig(next);
            setApiKeyInput('');
            setShowKey(false);
            setFeedback({ type: 'success', message: 'TronScan configuration saved.' });
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save.' });
        } finally {
            setSaving(false);
        }
    }, [apiKeyInput, baseUrl, source, enabled, applyConfig]);

    /**
     * Clear the stored key via the backend sentinel, returning to keyless mode.
     */
    const handleClearKey = useCallback(async () => {
        setSaving(true);
        setFeedback(null);
        try {
            const next = await updateTronScanConfig({ apiKey: CLEAR_SENTINEL });
            applyConfig(next);
            setApiKeyInput('');
            setFeedback({ type: 'success', message: 'API key cleared (now keyless).' });
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to clear key.' });
        } finally {
            setSaving(false);
        }
    }, [applyConfig]);

    /**
     * Run a live connectivity/credential test against the *saved* config.
     */
    const handleTest = useCallback(async () => {
        setTesting(true);
        setTestResult(null);
        try {
            setTestResult(await testTronScan());
        } catch (err) {
            setTestResult({ ok: false, message: err instanceof Error ? err.message : 'Test failed.' });
        } finally {
            setTesting(false);
        }
    }, []);

    if (loading) {
        return <Card padding="md"><span className="text-muted">Loading TronScan configuration…</span></Card>;
    }

    return (
        <Card padding="md">
            <Stack gap="md">
                <div className={styles.provider_header}>
                    <Plug size={16} aria-hidden style={{ color: 'var(--color-primary)' }} />
                    <h3 className={styles.provider_title}>TronScan</h3>
                    {config?.apiKeyConfigured ? (
                        <Badge tone="success">Key configured</Badge>
                    ) : (
                        <Badge tone="neutral">Keyless</Badge>
                    )}
                    {config && !config.enabled && <Badge tone="warning">Disabled</Badge>}
                </div>

                <p className="text-muted">
                    Supplies the local daily <strong>TRX</strong> price history that powers portfolio valuation. An API key is
                    optional — TronScan works keyless at lower rate limits; add a key to raise them. TRC20 token history is not
                    sourced here.
                </p>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="tronscan-enabled">Enabled</label>
                    <Switch
                        on={enabled}
                        onChange={setEnabled}
                        disabled={saving}
                        aria-label="Enable TronScan price ingestion"
                    />
                    <span className={styles.hint}>When off, TRX price ingestion pauses.</span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="tronscan-key">API key (optional)</label>
                    <div className={styles.input_row}>
                        <Input
                            id="tronscan-key"
                            type={showKey ? 'text' : 'password'}
                            value={apiKeyInput}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setApiKeyInput(e.target.value)}
                            placeholder={config?.apiKeyConfigured ? `Configured (${config.apiKey}) — type to replace` : 'Paste a TronScan API key'}
                            disabled={saving}
                            aria-label="TronScan API key"
                        />
                        <button
                            type="button"
                            onClick={() => setShowKey((v) => !v)}
                            className={styles.icon_btn}
                            disabled={saving}
                            aria-label={showKey ? 'Hide key' : 'Show key'}
                        >
                            {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                        </button>
                        {config?.apiKeyConfigured && (
                            <Button variant="ghost" size="sm" onClick={handleClearKey} disabled={saving}>Clear</Button>
                        )}
                    </div>
                    <span className={styles.hint}>
                        Get a key from{' '}
                        <a className={styles.docs_link} href={TRONSCAN_KEYS_URL} target="_blank" rel="noopener noreferrer">
                            TronScan API keys <ExternalLink size={12} aria-hidden />
                        </a>
                        . Leave blank to stay keyless.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="tronscan-source">Price source</label>
                    <select
                        id="tronscan-source"
                        className={styles.source_select}
                        value={source}
                        onChange={(e: ChangeEvent<HTMLSelectElement>) => setSource(e.target.value as TronScanPriceSource)}
                        disabled={saving}
                    >
                        <option value="coinmarketcap">CoinMarketCap</option>
                        <option value="coingecko">CoinGecko</option>
                    </select>
                    <span className={styles.hint}>Which upstream TronScan reports TRX prices from.</span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="tronscan-base">Base URL</label>
                    <Input
                        id="tronscan-base"
                        type="text"
                        value={baseUrl}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
                        placeholder="https://apilist.tronscanapi.com"
                        disabled={saving}
                        aria-label="TronScan base URL"
                    />
                </div>

                <div className={styles.actions}>
                    <Button variant="primary" size="md" onClick={handleSave} loading={saving} disabled={saving}>
                        Save
                    </Button>
                    <Button variant="secondary" size="md" onClick={handleTest} loading={testing} disabled={saving || testing}>
                        Test connection
                    </Button>
                    <span className={styles.hint}>Test uses the saved config — save a new key before testing it.</span>
                </div>

                {testResult && (
                    <div className={testResult.ok ? styles.feedback_success : styles.feedback_error}>
                        {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                        <span>
                            {testResult.message}
                            {typeof testResult.latencyMs === 'number' && ` (${testResult.latencyMs} ms${testResult.usingKey ? ', with key' : ', keyless'})`}
                        </span>
                    </div>
                )}

                {feedback && (
                    <div className={feedback.type === 'success' ? styles.feedback_success : styles.feedback_error}>
                        {feedback.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                        <span>{feedback.message}</span>
                    </div>
                )}
            </Stack>
        </Card>
    );
}
