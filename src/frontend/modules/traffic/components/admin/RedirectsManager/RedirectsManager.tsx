'use client';

/**
 * Admin-managed URL redirect panel.
 *
 * Lets an operator add, toggle, and delete legacy-URL 301/302 rules that the
 * Next.js edge middleware serves at request time. Redirects are the fix for the
 * dead 404s Search Console surfaces on the sibling SEO tab, so this panel lives
 * one tab over: see a 404 there, add the redirect here — no deploy, the
 * middleware picks up new rules on its next cache refresh.
 *
 * Like the other `/system/traffic` admin panels (GscSettings, IgnoredUsers) this
 * is an admin-only surface that fetches client-side after auth rather than
 * SSR-first — the SSR + Live Updates rule targets public-facing components.
 */

import { useState, useEffect, useCallback } from 'react';
import { isAxiosError } from 'axios';
import { CornerUpRight, ArrowRight, Trash2, Power, PowerOff, Plus } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { Input } from '../../../../../components/ui/Input';
import { Card } from '../../../../../components/ui/Card';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Stack } from '../../../../../components/layout';
import {
    adminListRedirects,
    adminCreateRedirect,
    adminUpdateRedirect,
    adminDeleteRedirect
} from '../../../api/client';
import type { IRedirectRuleAdmin } from '../../../api/client';
import styles from './RedirectsManager.module.scss';

/**
 * Pull an operator-readable message off a failed request, preferring the
 * backend's `{ message | error }` body (which carries the 400 validation reason
 * or the 409 duplicate-pattern message) over a bare axios string.
 *
 * @param err - The thrown value from an API call.
 * @param fallback - Message to use when nothing better can be extracted.
 * @returns The best available message.
 */
function extractError(err: unknown, fallback: string): string {
    let message = fallback;
    if (isAxiosError<{ message?: string; error?: string }>(err)) {
        message = err.response?.data?.message || err.response?.data?.error || fallback;
    } else if (err instanceof Error) {
        message = err.message;
    }
    return message;
}

/**
 * Redirect management panel for the `/system/traffic` Redirects tab.
 *
 * @returns The panel: an add-rule form above a table of existing rules.
 */
export function RedirectsManager() {
    const [rules, setRules] = useState<IRedirectRuleAdmin[] | null>(null);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState<string | null>(null);

    const [pattern, setPattern] = useState('');
    const [destination, setDestination] = useState('');
    const [isPrefix, setIsPrefix] = useState(true);
    const [permanent, setPermanent] = useState(true);
    const [notes, setNotes] = useState('');

    const [creating, setCreating] = useState(false);
    const [formError, setFormError] = useState<string | null>(null);
    const [actionError, setActionError] = useState<string | null>(null);

    /**
     * Load all rules from the admin endpoint. Failure leaves the table empty
     * with an inline message rather than throwing.
     */
    const fetchRules = useCallback(async () => {
        setLoadError(null);
        try {
            setRules(await adminListRedirects());
        } catch {
            setLoadError('Failed to load redirects');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        void fetchRules();
    }, [fetchRules]);

    /**
     * Create a rule from the form. Client-side it only checks both paths are
     * present; the backend enforces the same-site, reserved-prefix, and
     * loop-prevention invariants and returns a 400/409 message shown inline.
     */
    const handleCreate = useCallback(async () => {
        if (!pattern.trim() || !destination.trim()) {
            setFormError('Source and destination are required');
            return;
        }
        setFormError(null);
        setCreating(true);
        try {
            const rule = await adminCreateRedirect({
                pattern: pattern.trim(),
                destination: destination.trim(),
                isPrefix,
                permanent,
                notes: notes.trim() || undefined
            });
            setRules(prev => [rule, ...(prev ?? [])]);
            setPattern('');
            setDestination('');
            setNotes('');
            setIsPrefix(true);
            setPermanent(true);
        } catch (err) {
            setFormError(extractError(err, 'Failed to create redirect'));
        } finally {
            setCreating(false);
        }
    }, [pattern, destination, isPrefix, permanent, notes]);

    /**
     * Flip a rule's enabled flag — the operator's kill switch that keeps the
     * rule but stops the middleware serving it.
     *
     * @param rule - The rule to toggle.
     */
    const handleToggle = useCallback(async (rule: IRedirectRuleAdmin) => {
        setActionError(null);
        try {
            const updated = await adminUpdateRedirect(rule.id, { enabled: !rule.enabled });
            setRules(prev => (prev ?? []).map(r => (r.id === updated.id ? updated : r)));
        } catch (err) {
            setActionError(extractError(err, 'Failed to update redirect'));
        }
    }, []);

    /**
     * Delete a rule after an explicit confirmation, since a removed redirect
     * re-opens the 404 it was covering.
     *
     * @param rule - The rule to delete.
     */
    const handleDelete = useCallback(async (rule: IRedirectRuleAdmin) => {
        if (!window.confirm(`Delete redirect ${rule.pattern} → ${rule.destination}?`)) {
            return;
        }
        setActionError(null);
        try {
            await adminDeleteRedirect(rule.id);
            setRules(prev => (prev ?? []).filter(r => r.id !== rule.id));
        } catch (err) {
            setActionError(extractError(err, 'Failed to delete redirect'));
        }
    }, []);

    if (loading) {
        return (
            <Card padding="lg">
                <p className="text-muted">Loading redirects...</p>
            </Card>
        );
    }

    return (
        <div className={styles.container}>
            <Card padding="lg">
                <Stack gap="md">
                    <div className={styles.header}>
                        <CornerUpRight size={16} aria-hidden="true" />
                        <h3>URL Redirects</h3>
                    </div>
                    <p className="text-muted">
                        301/302 redirects for legacy URLs. When a page moves, add a rule so the
                        old path forwards to the new one instead of 404ing &mdash; this recovers the
                        crawl equity Google holds for the old URL. Rules are served to the edge
                        middleware and go live within a minute of saving; no deploy needed.
                        A <strong>prefix</strong> rule also matches sub-paths (e.g. <code>/old</code>{' '}
                        catches <code>/old/anything</code>); an <strong>exact</strong> rule matches only
                        the path itself.
                    </p>

                    <div className={styles.form}>
                        <div className={styles.form_row}>
                            <div className={styles.field}>
                                <label className={styles.label} htmlFor="redirect-source">Source path</label>
                                <Input
                                    id="redirect-source"
                                    type="text"
                                    value={pattern}
                                    onChange={e => setPattern(e.target.value)}
                                    placeholder="/tron-forum"
                                />
                            </div>
                            <div className={styles.field}>
                                <label className={styles.label} htmlFor="redirect-destination">Destination path</label>
                                <Input
                                    id="redirect-destination"
                                    type="text"
                                    value={destination}
                                    onChange={e => setDestination(e.target.value)}
                                    placeholder="/forum"
                                />
                            </div>
                        </div>
                        <div className={styles.field}>
                            <label className={styles.label} htmlFor="redirect-notes">Note (optional)</label>
                            <Input
                                id="redirect-notes"
                                type="text"
                                value={notes}
                                onChange={e => setNotes(e.target.value)}
                                placeholder="Why this redirect exists"
                            />
                        </div>
                        <div className={styles.options}>
                            <label className={styles.checkbox}>
                                <input type="checkbox" checked={isPrefix} onChange={e => setIsPrefix(e.target.checked)} />
                                Prefix match
                            </label>
                            <label className={styles.checkbox}>
                                <input type="checkbox" checked={permanent} onChange={e => setPermanent(e.target.checked)} />
                                Permanent (301)
                            </label>
                            <Button type="button" size="sm" onClick={handleCreate} loading={creating}>
                                <Plus size={16} aria-hidden="true" /> Add redirect
                            </Button>
                        </div>
                        {formError && <div className={styles.error}>{formError}</div>}
                    </div>

                    {actionError && <div className={styles.error}>{actionError}</div>}
                    {loadError && <div className={styles.error}>{loadError}</div>}

                    {rules && rules.length > 0 ? (
                        <div className="table-scroll">
                            <table className="table">
                                <thead>
                                    <tr>
                                        <th scope="col">Source</th>
                                        <th scope="col">Destination</th>
                                        <th scope="col">Match</th>
                                        <th scope="col">Code</th>
                                        <th scope="col">Status</th>
                                        <th scope="col">Updated</th>
                                        <th scope="col" className={styles.actions_col}>Actions</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {rules.map(rule => (
                                        <tr key={rule.id} className={rule.enabled ? undefined : styles.row_disabled}>
                                            <td>
                                                <code className={styles.path}>{rule.pattern}</code>
                                                {rule.notes && <span className={styles.note}>{rule.notes}</span>}
                                            </td>
                                            <td>
                                                <span className={styles.dest}>
                                                    <ArrowRight size={14} aria-hidden="true" />
                                                    <code className={styles.path}>{rule.destination}</code>
                                                </span>
                                            </td>
                                            <td>
                                                <Badge tone="neutral">{rule.isPrefix ? 'prefix' : 'exact'}</Badge>
                                            </td>
                                            <td>
                                                <Badge tone={rule.permanent ? 'info' : 'neutral'}>
                                                    {rule.permanent ? '301' : '302'}
                                                </Badge>
                                            </td>
                                            <td>
                                                <Badge tone={rule.enabled ? 'success' : 'neutral'}>
                                                    {rule.enabled ? 'active' : 'disabled'}
                                                </Badge>
                                            </td>
                                            <td>
                                                <ClientTime date={rule.updatedAt} format="date" />
                                            </td>
                                            <td>
                                                <div className={styles.actions}>
                                                    <button
                                                        type="button"
                                                        className={styles.icon_btn}
                                                        onClick={() => handleToggle(rule)}
                                                        aria-label={rule.enabled ? 'Disable redirect' : 'Enable redirect'}
                                                        title={rule.enabled ? 'Disable' : 'Enable'}
                                                    >
                                                        {rule.enabled ? <Power size={16} /> : <PowerOff size={16} />}
                                                    </button>
                                                    <button
                                                        type="button"
                                                        className={`${styles.icon_btn} ${styles.icon_btn__danger}`}
                                                        onClick={() => handleDelete(rule)}
                                                        aria-label="Delete redirect"
                                                        title="Delete"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    ) : (
                        !loadError && <p className="text-muted">No redirects yet. Add one above.</p>
                    )}
                </Stack>
            </Card>
        </div>
    );
}
