'use client';

/**
 * @fileoverview Screen Settings section of the Registry tab — the operator's
 * controls for the untrusted-content output screen, the defense-in-depth pass
 * that inspects a tool result before it reaches the model. Every behaviour is
 * configuration, never a hard-coded constant: a master switch, a posture (screen
 * always, or only once an external egress sink arms the lethal trifecta), a
 * failure mode (forward the result when the screen can't run, or withhold it),
 * and an offender throttle threshold. Each control PUTs only its own field so a
 * rejected value 400s in isolation, and the section reflects the server's full
 * effective config back into state on every save.
 *
 * Admin surface (behind `requireAdmin`), so it follows the sibling sections'
 * client-fetch pattern rather than SSR — a loading line on a user-opened section
 * is acceptable here.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle } from 'lucide-react';
import type {
    IUntrustedScreenConfig,
    UntrustedScreenFailureMode,
    UntrustedScreenPostureMode
} from '@/types';
import { Stack } from '../../../../../components/layout';
import { Input } from '../../../../../components/ui/Input';
import { Select } from '../../../../../components/ui/Select';
import { Switch } from '../../../../../components/ui/Switch';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { getScreenConfig, setScreenConfig } from '../../../../../modules/ai-tools';
import { CollapsibleSection } from '../components/CollapsibleSection';
import styles from '../page.module.scss';
import screenStyles from './ScreenSettingsSection.module.scss';

/**
 * Untrusted-content output screen settings section.
 *
 * @returns The section.
 */
export function ScreenSettingsSection() {
    const [config, setConfig] = useState<IUntrustedScreenConfig | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    /**
     * Load the effective screen config once on mount. Memoized so the mount effect
     * runs it a single time; failures surface inline rather than as a toast because
     * the whole section depends on this fetch succeeding.
     */
    const load = useCallback(async () => {
        try {
            setConfig(await getScreenConfig());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load screen settings');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    /**
     * Persist a single-field patch and reflect the server's validated effective
     * config back into state. Patching one field at a time keeps each control's
     * save independent — a bad value 400s without disturbing the others — and the
     * returned config is authoritative, so the UI never drifts from what the
     * backend actually stored.
     *
     * @param patch - The one field the operator just changed.
     */
    const save = useCallback(async (patch: Partial<IUntrustedScreenConfig>) => {
        setSaving(true);
        try {
            const updated = await setScreenConfig(patch);
            setConfig(updated);
            push({ tone: 'success', title: 'Screen settings saved' });
        } catch (err) {
            push({ tone: 'danger', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setSaving(false);
        }
    }, [push]);

    const summary = loading || !config
        ? 'Loading…'
        : `${config.enabled ? 'on' : 'off'} · ${config.postureMode === 'always' ? 'always' : 'trifecta'} · fail ${config.onFailure}`;

    return (
        <CollapsibleSection title="Screen Settings" summary={summary}>
            <Stack gap="md">
                <p className={styles.tool_desc}>
                    The untrusted-content output screen inspects a tool result before it reaches the model — a
                    defense-in-depth pass against prompt injection riding in fetched content. These controls govern
                    the whole screen without a deploy.
                </p>

                {error && (
                    <div className="alert" role="alert">
                        <AlertCircle size={16} style={{ color: 'var(--color-danger)', verticalAlign: 'text-bottom' }} /> {error}
                    </div>
                )}

                {!loading && config && (
                    <div className={screenStyles.controls}>
                        <div className={screenStyles.grid}>
                        <div className={styles.policy_field}>
                            <span className={styles.policy_field_label}>Enabled</span>
                            <Switch
                                on={config.enabled}
                                onChange={next => void save({ enabled: next })}
                                disabled={saving}
                                aria-label={`${config.enabled ? 'Disable' : 'Enable'} the untrusted-content output screen`}
                            />
                            <span className={styles.policy_field_help}>
                                Master switch. When off, the screen never runs and results flow exactly as before.
                            </span>
                        </div>

                        <div className={styles.policy_field}>
                            <span className={styles.policy_field_label}>Posture</span>
                            <Select
                                className={styles.cell_control}
                                value={config.postureMode}
                                onChange={e => void save({ postureMode: e.target.value as UntrustedScreenPostureMode })}
                                disabled={saving}
                                aria-label="Screen posture mode"
                            >
                                <option value="trifecta">Only when trifecta armed</option>
                                <option value="always">Always</option>
                            </Select>
                            <span className={styles.policy_field_help}>
                                <strong>Trifecta</strong> screens only when an external egress sink is enabled — zero
                                cost until exfiltration is possible. <strong>Always</strong> screens every
                                untrusted-content result.
                            </span>
                        </div>

                        <div className={styles.policy_field}>
                            <span className={styles.policy_field_label}>On failure</span>
                            <Select
                                className={styles.cell_control}
                                value={config.onFailure}
                                onChange={e => void save({ onFailure: e.target.value as UntrustedScreenFailureMode })}
                                disabled={saving}
                                aria-label="Screen failure mode"
                            >
                                <option value="open">Fail open (forward result)</option>
                                <option value="closed">Fail closed (withhold result)</option>
                            </Select>
                            <span className={styles.policy_field_help}>
                                <strong>Fail open</strong>: if the screen can't run, forward the result anyway —
                                defense-in-depth degrades gracefully. <strong>Fail closed</strong>: withhold it.
                            </span>
                        </div>

                        <div className={styles.policy_field}>
                            <span className={styles.policy_field_label}>Offender threshold</span>
                            <Input
                                className={styles.cell_control}
                                type="number"
                                min={0}
                                step={1}
                                value={config.offenderThreshold}
                                onChange={e => setConfig(current => current && { ...current, offenderThreshold: Number(e.target.value) || 0 })}
                                onBlur={e => {
                                    // Persist on every blur: onChange has already written the
                                    // typed value into `config`, so a draft-vs-config comparison
                                    // here is always false and would silently drop the save.
                                    void save({ offenderThreshold: Math.max(0, Math.trunc(Number(e.target.value) || 0)) });
                                }}
                                disabled={saving}
                                aria-label="Offender throttle threshold"
                            />
                            <span className={styles.policy_field_help}>
                                Flagged results from one tool within a window before it's throttled. 0 disables
                                throttling.
                            </span>
                        </div>
                        </div>
                    </div>
                )}
            </Stack>
        </CollapsibleSection>
    );
}
