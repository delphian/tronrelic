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
import { Eye, EyeOff, CheckCircle, AlertCircle, ExternalLink, Trash2, Plus } from 'lucide-react';
import { Card } from '../../../../../../../components/ui/Card';
import { Panel } from '../../../../../../../components/ui/Panel';
import { Button } from '../../../../../../../components/ui/Button';
import { Field } from '../../../../../../../components/ui/Field';
import { IconButton } from '../../../../../../../components/ui/IconButton';
import { Input } from '../../../../../../../components/ui/Input';
import { Switch } from '../../../../../../../components/ui/Switch';
import { Badge } from '../../../../../../../components/ui/Badge';
import { Stack } from '../../../../../../../components/layout';
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
        <Panel
            title="TronGrid"
            meta={(
                <span className={styles.badges}>
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
                </span>
            )}
            actions={(
                <>
                    <Button
                        variant="secondary"
                        onClick={handleTest}
                        loading={testing}
                        disabled={busy}
                        title="Probes every stored key with the saved config, so save before testing a new one"
                    >
                        Test connection
                    </Button>
                    <Button variant="primary" onClick={handleSave} loading={saving} disabled={busy}>
                        Save
                    </Button>
                </>
            )}
        >
            <p className={styles.description}>
                Sync, chain parameters, and account history still reach TronGrid through the TRONGRID_API_KEY
                environment variables and a host fixed in source, so the connection settings below change none of it
                until the switchover moves the client onto them. Block receipts is the exception and takes effect
                immediately.
            </p>

            <div className={styles.field_grid}>
                <Field
                    inline
                    label="Block receipts"
                    htmlFor="trongrid-receipts"
                    className={styles.field_wide}
                    hint="Off by default, which leaves energy, bandwidth, and internal transactions empty on every transaction. On adds one request per block, not per transaction, and fills them in from the next block onward; blocks already indexed are not backfilled."
                >
                    <Switch
                        id="trongrid-receipts"
                        on={fetchBlockReceipts}
                        onChange={setFetchBlockReceipts}
                        disabled={busy}
                        aria-label="Block receipts"
                    />
                </Field>

                <Field
                    inline
                    label="Enabled"
                    htmlFor="trongrid-enabled"
                    hint="Reserved for the switchover. Until then this flag is recorded and nothing acts on it."
                >
                    <Switch
                        id="trongrid-enabled"
                        on={enabled}
                        onChange={setEnabled}
                        disabled={busy}
                        aria-label="Enabled"
                    />
                </Field>

                <Field
                    label="Base URL"
                    className={styles.field_wide}
                    hint="Serves both the REST calls and the TronWeb full node. Point it at a private node to leave the public API."
                >
                    <Input
                        id="trongrid-base"
                        type="text"
                        value={baseUrl}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setBaseUrl(e.target.value)}
                        placeholder="https://api.trongrid.io"
                        className={styles.mono}
                        disabled={busy}
                    />
                </Field>

                <Field label="Request throttle (ms)" hint="Minimum delay between outbound requests. Lower burns the rate limit faster; 0 removes pacing.">
                    <Input
                        id="trongrid-throttle"
                        type="number"
                        inputMode="numeric"
                        min={TRONGRID_FIELD_LIMITS.requestThrottleMs.min}
                        max={TRONGRID_FIELD_LIMITS.requestThrottleMs.max}
                        value={throttleMs}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setThrottleMs(e.target.value)}
                        disabled={busy}
                    />
                </Field>

                <Field label="Max queue size" hint="Callers that may wait on the serial request queue before new ones are rejected, so the queue cannot grow without bound when TronGrid slows down.">
                    <Input
                        id="trongrid-queue"
                        type="number"
                        inputMode="numeric"
                        min={TRONGRID_FIELD_LIMITS.maxQueueSize.min}
                        max={TRONGRID_FIELD_LIMITS.maxQueueSize.max}
                        value={maxQueueSize}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setMaxQueueSize(e.target.value)}
                        disabled={busy}
                    />
                </Field>

                <Field label="Request timeout (ms)" hint="Per-request HTTP timeout before the call is abandoned and retried.">
                    <Input
                        id="trongrid-timeout"
                        type="number"
                        inputMode="numeric"
                        min={TRONGRID_FIELD_LIMITS.requestTimeoutMs.min}
                        max={TRONGRID_FIELD_LIMITS.requestTimeoutMs.max}
                        value={timeoutMs}
                        onChange={(e: ChangeEvent<HTMLInputElement>) => setTimeoutMs(e.target.value)}
                        disabled={busy}
                    />
                </Field>

                <Field
                    label="API keys"
                    htmlFor="trongrid-key"
                    className={styles.field_wide}
                    hint={(
                        // One element, so the field's message column keeps the
                        // sentence and its link on one flowing line.
                        <span>
                            Keys rotate round-robin, so each adds its own rate-limit allowance. Get one from{' '}
                            <a className={styles.docs_link} href={TRONGRID_KEYS_URL} target="_blank" rel="noopener noreferrer">
                                TronGrid <ExternalLink size={14} aria-hidden />
                            </a>
                            . Keys are stored and shown masked; Test connection probes every saved key.
                        </span>
                    )}
                >
                    <div>
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
                            <p className={styles.hint}>
                                No keys stored — requests would use TronGrid&apos;s shared per-IP pool.
                            </p>
                        )}
                        <div className={styles.input_row}>
                            <Input
                                id="trongrid-key"
                                aria-describedby="trongrid-key-hint"
                                type={showKey ? 'text' : 'password'}
                                value={keyInput}
                                onChange={(e: ChangeEvent<HTMLInputElement>) => setKeyInput(e.target.value)}
                                placeholder="Paste a TronGrid API key"
                                className={styles.mono}
                                disabled={busy}
                            />
                            <IconButton
                                onClick={() => setShowKey((v) => !v)}
                                disabled={busy}
                                aria-label={showKey ? 'Hide key' : 'Show key'}
                            >
                                {showKey ? <EyeOff size={18} /> : <Eye size={18} />}
                            </IconButton>
                            <Button variant="secondary" onClick={handleAddKey} loading={addingKey} disabled={busy} icon={<Plus size={18} aria-hidden />}>
                                Add
                            </Button>
                        </div>
                    </div>
                </Field>
            </div>

            {testResult && (
                <Stack gap="sm">
                    <div className={testResult.ok ? styles.feedback_success : styles.feedback_error} role="status">
                        {testResult.ok ? <CheckCircle size={16} aria-hidden /> : <AlertCircle size={16} aria-hidden />}
                        <span>{testResult.message}</span>
                    </div>
                    {testResult.keyResults.map((probe, index) => (
                        <div
                            key={`${probe.index ?? 'keyless'}-${index}`}
                            className={probe.ok ? styles.feedback_success : styles.feedback_error}
                        >
                            {probe.ok ? <CheckCircle size={16} aria-hidden /> : <AlertCircle size={16} aria-hidden />}
                            <span>
                                {probe.message}
                                {typeof probe.latencyMs === 'number' && ` (${probe.latencyMs} ms)`}
                            </span>
                        </div>
                    ))}
                </Stack>
            )}

            {feedback && (
                <div className={feedback.type === 'success' ? styles.feedback_success : styles.feedback_error} role="status">
                    {feedback.type === 'success' ? <CheckCircle size={16} aria-hidden /> : <AlertCircle size={16} aria-hidden />}
                    <span>{feedback.message}</span>
                </div>
            )}
        </Panel>
    );
}
