'use client';

/**
 * @fileoverview TronGrid provider configuration section.
 *
 * Stages the TronGrid settings that today live in env and source — the three
 * `TRONGRID_API_KEY*` variables and a hardcoded `https://api.trongrid.io` host,
 * request throttle, queue ceiling, and timeout — in the database, ahead of the
 * switchover that will point the blockchain client at them. Nothing reads this
 * config yet, so the card says so plainly: an operator filling it in must not
 * believe they have just changed how sync talks to TronGrid.
 *
 * Keys are handled as a pool rather than a single field because TronGrid access
 * is rotated round-robin across accounts. They are added and removed one at a
 * time and only ever displayed masked, so no form round-trip can overwrite a
 * real key with the `****abcd` the browser was shown. The Test button probes
 * every stored key in turn — a revoked key in a rotation pool otherwise stays
 * invisible until it causes intermittent failures after the cutover.
 */

import { useEffect, useState, useCallback, type ChangeEvent } from 'react';
import { Plug, Eye, EyeOff, CheckCircle, AlertCircle, ExternalLink, Trash2, Plus } from 'lucide-react';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { IconButton } from '../../../../../components/ui/IconButton';
import { Input } from '../../../../../components/ui/Input';
import { Switch } from '../../../../../components/ui/Switch';
import { Badge } from '../../../../../components/ui/Badge';
import { Stack } from '../../../../../components/layout';
import { readFieldInteger } from './field-integer';
import {
    getTronGridConfig,
    updateTronGridConfig,
    addTronGridApiKey,
    removeTronGridApiKey,
    testTronGrid,
    TRONGRID_FIELD_LIMITS,
    type ITronGridConfigView,
    type ITronGridTestResult
} from './providers-api';
import styles from './ProviderSection.module.scss';

/** Where an operator obtains a TronGrid API key. */
const TRONGRID_KEYS_URL = 'https://www.trongrid.io/';

/** How long a success message stays on screen before clearing itself. */
const FEEDBACK_TIMEOUT_MS = 4000;

/**
 * Render and manage the staged TronGrid provider config form.
 *
 * @returns The configuration section.
 */
export function TronGridProviderSection() {
    const [loading, setLoading] = useState(true);
    const [config, setConfig] = useState<ITronGridConfigView | null>(null);
    const [enabled, setEnabled] = useState(false);
    const [fetchBlockReceipts, setFetchBlockReceipts] = useState(false);
    const [baseUrl, setBaseUrl] = useState('');
    const [throttleMs, setThrottleMs] = useState('');
    const [maxQueueSize, setMaxQueueSize] = useState('');
    const [timeoutMs, setTimeoutMs] = useState('');
    const [keyInput, setKeyInput] = useState('');
    const [showKey, setShowKey] = useState(false);
    const [saving, setSaving] = useState(false);
    const [busyKeyIndex, setBusyKeyIndex] = useState<number | null>(null);
    const [addingKey, setAddingKey] = useState(false);
    const [testing, setTesting] = useState(false);
    const [testResult, setTestResult] = useState<ITronGridTestResult | null>(null);
    const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

    /**
     * Seed local form state from a freshly-fetched masked config. Numeric fields
     * are held as strings so a half-typed value (or a cleared box) survives
     * editing instead of snapping back to a coerced number.
     *
     * @param next - The masked config to apply.
     */
    const applyConfig = useCallback((next: ITronGridConfigView) => {
        setConfig(next);
        setEnabled(next.enabled);
        setFetchBlockReceipts(next.fetchBlockReceipts);
        setBaseUrl(next.baseUrl);
        setThrottleMs(String(next.requestThrottleMs));
        setMaxQueueSize(String(next.maxQueueSize));
        setTimeoutMs(String(next.requestTimeoutMs));
    }, []);

    useEffect(() => {
        let active = true;
        getTronGridConfig()
            .then((cfg) => {
                if (active) {
                    applyConfig(cfg);
                }
            })
            .catch(() => {
                if (active) {
                    setFeedback({ type: 'error', message: 'Failed to load TronGrid config.' });
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
     * Auto-dismiss a success message. Driving this from an effect rather than a
     * per-handler timer guarantees the timeout is cleared on unmount and whenever
     * newer feedback replaces it, so no stale timer fires after unmount and
     * back-to-back saves cannot clear a fresh message early.
     */
    useEffect(() => {
        const timer = feedback?.type === 'success'
            ? setTimeout(() => setFeedback(null), FEEDBACK_TIMEOUT_MS)
            : undefined;
        return () => clearTimeout(timer);
    }, [feedback]);

    /**
     * Persist the non-secret fields. Numbers are validated here as well as on the
     * backend so an out-of-range entry is named at the field rather than coming
     * back as a generic save failure.
     */
    const handleSave = useCallback(async () => {
        const throttle = readFieldInteger(throttleMs, TRONGRID_FIELD_LIMITS.requestThrottleMs);
        const queue = readFieldInteger(maxQueueSize, TRONGRID_FIELD_LIMITS.maxQueueSize);
        const timeout = readFieldInteger(timeoutMs, TRONGRID_FIELD_LIMITS.requestTimeoutMs);
        const invalid: string[] = [];
        if (throttle === null) {
            invalid.push(`Request throttle must be ${TRONGRID_FIELD_LIMITS.requestThrottleMs.min}–${TRONGRID_FIELD_LIMITS.requestThrottleMs.max} ms`);
        }
        if (queue === null) {
            invalid.push(`Max queue size must be ${TRONGRID_FIELD_LIMITS.maxQueueSize.min}–${TRONGRID_FIELD_LIMITS.maxQueueSize.max}`);
        }
        if (timeout === null) {
            invalid.push(`Request timeout must be ${TRONGRID_FIELD_LIMITS.requestTimeoutMs.min}–${TRONGRID_FIELD_LIMITS.requestTimeoutMs.max} ms`);
        }
        if (throttle === null || queue === null || timeout === null) {
            setFeedback({ type: 'error', message: invalid.join('; ') });
            return;
        }
        // Everything else on this card is inert until the client switchover, so a
        // save that only touched those fields changes nothing an operator can
        // observe. Receipt fetching does change sync behaviour immediately, and it
        // costs upstream requests, so it is confirmed before it is turned on.
        if (fetchBlockReceipts && !config?.fetchBlockReceipts) {
            const confirmed = window.confirm(
                'Turn on block receipt fetching?\n\n'
                    + 'Blockchain sync will make one extra TronGrid request per block from the next block onward, '
                    + 'and newly indexed transactions will start carrying energy, bandwidth, and internal transaction data. '
                    + 'Blocks already indexed are not backfilled.'
            );
            if (!confirmed) {
                return;
            }
        }

        setSaving(true);
        setFeedback(null);
        setTestResult(null);
        try {
            const next = await updateTronGridConfig({
                enabled,
                fetchBlockReceipts,
                baseUrl: baseUrl.trim(),
                requestThrottleMs: throttle,
                maxQueueSize: queue,
                requestTimeoutMs: timeout
            });
            applyConfig(next);
            setFeedback({ type: 'success', message: 'TronGrid configuration saved.' });
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to save.' });
        } finally {
            setSaving(false);
        }
    }, [enabled, fetchBlockReceipts, baseUrl, throttleMs, maxQueueSize, timeoutMs, config, applyConfig]);

    /**
     * Append the typed key to the rotation pool and clear the input, so the raw
     * value does not linger in the form after it has been stored.
     */
    const handleAddKey = useCallback(async () => {
        if (!keyInput.trim()) {
            setFeedback({ type: 'error', message: 'Paste a key before adding it.' });
            return;
        }
        setAddingKey(true);
        setFeedback(null);
        try {
            const next = await addTronGridApiKey(keyInput.trim());
            applyConfig(next);
            setKeyInput('');
            setShowKey(false);
            setFeedback({ type: 'success', message: 'API key added to the rotation.' });
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to add key.' });
        } finally {
            setAddingKey(false);
        }
    }, [keyInput, applyConfig]);

    /**
     * Drop a key from the rotation by its position.
     *
     * @param index - Zero-based rotation position to remove.
     */
    const handleRemoveKey = useCallback(async (index: number) => {
        setBusyKeyIndex(index);
        setFeedback(null);
        try {
            const next = await removeTronGridApiKey(index);
            applyConfig(next);
            setFeedback({ type: 'success', message: 'API key removed.' });
        } catch (err) {
            setFeedback({ type: 'error', message: err instanceof Error ? err.message : 'Failed to remove key.' });
        } finally {
            setBusyKeyIndex(null);
        }
    }, [applyConfig]);

    /**
     * Probe the *saved* config — every stored key in turn, or once keyless.
     */
    const handleTest = useCallback(async () => {
        setTesting(true);
        setTestResult(null);
        try {
            setTestResult(await testTronGrid());
        } catch (err) {
            setTestResult({
                ok: false,
                message: err instanceof Error ? err.message : 'Test failed.',
                keyResults: []
            });
        } finally {
            setTesting(false);
        }
    }, []);

    if (loading) {
        return <Card padding="sm" noBackgroundImage><span className="text-muted">Loading TronGrid configuration…</span></Card>;
    }

    // A probe can legitimately run for several seconds across a full key pool.
    // Editing during that window is what makes its output misleading: the result
    // rows name keys by rotation position, so removing one mid-run leaves
    // "Key 2" pointing at a slot that no longer holds the key it probed.
    const busy = saving || addingKey || testing || busyKeyIndex !== null;

    return (
        <Card padding="sm" noBackgroundImage>
            <Stack gap="md">
                <div className={styles.provider_header}>
                    <Plug size={16} aria-hidden style={{ color: 'var(--color-primary)' }} />
                    <h3 className={styles.provider_title}>TronGrid</h3>
                    {config && config.apiKeyCount > 0 ? (
                        <Badge tone="success">{config.apiKeyCount} key{config.apiKeyCount === 1 ? '' : 's'}</Badge>
                    ) : (
                        <Badge tone="neutral">Keyless</Badge>
                    )}
                    {config?.fetchBlockReceipts ? (
                        <Badge tone="info">Receipts on</Badge>
                    ) : (
                        <Badge tone="warning">Connection staged</Badge>
                    )}
                </div>

                <p className="text-muted">
                    Blockchain sync, chain parameters, and account history all reach TRON through TronGrid. That access is
                    still configured by the <strong>TRONGRID_API_KEY</strong> environment variables and a host fixed in
                    source — <strong>the connection settings below change none of it</strong>. They store the same values in
                    the database so they are in place, and verified, before the switchover moves the client onto them.
                    <strong> Block receipts is the exception</strong>: that switch takes effect immediately.
                </p>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="trongrid-receipts">Block receipts</label>
                    <Switch
                        id="trongrid-receipts"
                        on={fetchBlockReceipts}
                        onChange={setFetchBlockReceipts}
                        disabled={busy}
                        aria-label="Fetch transaction receipts for every synced block"
                    />
                    <span className={styles.hint}>
                        Off by default. Sync reads a block&apos;s transactions but not their receipts, so energy, bandwidth,
                        and internal transactions are absent on every transaction and the block totals that add them up are
                        always zero. Turning this on adds <strong>one</strong> request per block — one for the whole block,
                        not one per transaction — and fills those fields in from the next block onward. Blocks already
                        indexed keep the zeros; nothing is backfilled.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="trongrid-enabled">Enabled</label>
                    <Switch
                        id="trongrid-enabled"
                        on={enabled}
                        onChange={setEnabled}
                        disabled={busy}
                        aria-label="Enable the database-backed TronGrid configuration"
                    />
                    <span className={styles.hint}>
                        Reserved for the switchover. Until then this flag is recorded and nothing acts on it.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="trongrid-base">Base URL</label>
                    <Input
                        id="trongrid-base"
                        type="text"
                        value={baseUrl}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
                        placeholder="https://api.trongrid.io"
                        disabled={busy}
                        aria-label="TronGrid base URL"
                    />
                    <span className={styles.hint}>
                        Serves both the REST calls and the TronWeb full node. Point it at a private node to leave the public
                        API entirely.
                    </span>
                </div>

                <div className={styles.field}>
                    <span className={styles.label}>API keys</span>
                    {config && config.apiKeys.length > 0 ? (
                        <ul className={styles.key_list}>
                            {config.apiKeys.map((maskedKey, index) => (
                                <li key={`${maskedKey}-${index}`} className={styles.key_row}>
                                    <span className={styles.key_position}>#{index + 1}</span>
                                    <span className={styles.key_value}>{maskedKey}</span>
                                    <IconButton
                                        onClick={() => handleRemoveKey(index)}
                                        disabled={busy}
                                        aria-label={`Remove API key ${index + 1}`}
                                    >
                                        <Trash2 size={18} />
                                    </IconButton>
                                </li>
                            ))}
                        </ul>
                    ) : (
                        <span className={styles.hint}>
                            No keys stored — requests would use TronGrid&apos;s shared per-IP pool.
                        </span>
                    )}
                    <div className={styles.input_row}>
                        <Input
                            id="trongrid-key"
                            type={showKey ? 'text' : 'password'}
                            value={keyInput}
                            onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyInput(e.target.value)}
                            placeholder="Paste a TronGrid API key"
                            disabled={busy}
                            aria-label="New TronGrid API key"
                        />
                        <IconButton
                            onClick={() => setShowKey((v) => !v)}
                            disabled={busy}
                            aria-label={showKey ? 'Hide key' : 'Show key'}
                        >
                            {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                        </IconButton>
                        <Button variant="secondary" size="sm" onClick={handleAddKey} loading={addingKey} disabled={busy}>
                            <Plus size={18} aria-hidden /> Add
                        </Button>
                    </div>
                    <span className={styles.hint}>
                        Keys rotate round-robin, so each one adds its own rate-limit allowance. Get one from{' '}
                        <a className={styles.docs_link} href={TRONGRID_KEYS_URL} target="_blank" rel="noopener noreferrer">
                            TronGrid <ExternalLink size={14} aria-hidden />
                        </a>
                        . Keys are stored and shown masked; add or remove them individually.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="trongrid-throttle">Request throttle (ms)</label>
                    <Input
                        id="trongrid-throttle"
                        type="number"
                        inputMode="numeric"
                        min={TRONGRID_FIELD_LIMITS.requestThrottleMs.min}
                        max={TRONGRID_FIELD_LIMITS.requestThrottleMs.max}
                        value={throttleMs}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setThrottleMs(e.target.value)}
                        disabled={busy}
                        aria-label="TronGrid request throttle in milliseconds"
                    />
                    <span className={styles.hint}>
                        Minimum delay between outbound requests. Lower burns the rate limit faster; 0 removes pacing.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="trongrid-queue">Max queue size</label>
                    <Input
                        id="trongrid-queue"
                        type="number"
                        inputMode="numeric"
                        min={TRONGRID_FIELD_LIMITS.maxQueueSize.min}
                        max={TRONGRID_FIELD_LIMITS.maxQueueSize.max}
                        value={maxQueueSize}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxQueueSize(e.target.value)}
                        disabled={busy}
                        aria-label="TronGrid maximum request queue size"
                    />
                    <span className={styles.hint}>
                        How many callers may wait on the serial request queue before new ones are rejected — the backstop
                        against unbounded queue growth when TronGrid slows down.
                    </span>
                </div>

                <div className={styles.field}>
                    <label className={styles.label} htmlFor="trongrid-timeout">Request timeout (ms)</label>
                    <Input
                        id="trongrid-timeout"
                        type="number"
                        inputMode="numeric"
                        min={TRONGRID_FIELD_LIMITS.requestTimeoutMs.min}
                        max={TRONGRID_FIELD_LIMITS.requestTimeoutMs.max}
                        value={timeoutMs}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setTimeoutMs(e.target.value)}
                        disabled={busy}
                        aria-label="TronGrid per-request timeout in milliseconds"
                    />
                    <span className={styles.hint}>Per-request HTTP timeout before the call is abandoned and retried.</span>
                </div>

                <div className={styles.actions}>
                    <Button variant="primary" size="md" onClick={handleSave} loading={saving} disabled={busy}>
                        Save
                    </Button>
                    <Button variant="secondary" size="md" onClick={handleTest} loading={testing} disabled={busy}>
                        Test connection
                    </Button>
                    <span className={styles.hint}>
                        Test uses the saved config and probes every stored key — save before testing a new one.
                    </span>
                </div>

                {testResult && (
                    <Stack gap="sm">
                        <div className={testResult.ok ? styles.feedback_success : styles.feedback_error}>
                            {testResult.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                            <span>{testResult.message}</span>
                        </div>
                        {testResult.keyResults.map((probe, index) => (
                            <div
                                key={`${probe.index ?? 'keyless'}-${index}`}
                                className={probe.ok ? styles.feedback_success : styles.feedback_error}
                            >
                                {probe.ok ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
                                <span>
                                    {probe.message}
                                    {typeof probe.latencyMs === 'number' && ` (${probe.latencyMs} ms)`}
                                </span>
                            </div>
                        ))}
                    </Stack>
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
