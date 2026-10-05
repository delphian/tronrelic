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
import type { FormEvent } from 'react';
import { isAxiosError } from 'axios';
import { ArrowRight, Trash2, Power, PowerOff, Plus, Pencil, Check, X } from 'lucide-react';
import { Button } from '../../../../../components/ui/Button';
import { IconButton } from '../../../../../components/ui/IconButton';
import { Input } from '../../../../../components/ui/Input';
import { Field } from '../../../../../components/ui/Field';
import { Panel } from '../../../../../components/ui/Panel';
import { Badge } from '../../../../../components/ui/Badge';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { AboutDetails } from '../AboutDetails';
import {
    adminListRedirects,
    adminCreateRedirect,
    adminUpdateRedirect,
    adminDeleteRedirect
} from '../../../api/client';
import type { IRedirectRuleAdmin, IRedirectRuleInput } from '../../../api/client';
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

    const [editingId, setEditingId] = useState<string | null>(null);
    const [draft, setDraft] = useState<IRedirectRuleInput | null>(null);
    const [savingEdit, setSavingEdit] = useState(false);

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

    /**
     * Enter inline-edit mode for a row, seeding the draft from the rule's
     * current values so the operator edits a copy rather than mutating the
     * live table until Save succeeds.
     *
     * @param rule - The rule whose row becomes editable.
     */
    const handleStartEdit = useCallback((rule: IRedirectRuleAdmin) => {
        setActionError(null);
        setEditingId(rule.id);
        setDraft({
            pattern: rule.pattern,
            destination: rule.destination,
            isPrefix: rule.isPrefix,
            permanent: rule.permanent,
            notes: rule.notes ?? ''
        });
    }, []);

    /**
     * Abandon an in-progress edit, discarding the draft so the row reverts to
     * its persisted values with no request sent.
     */
    const handleCancelEdit = useCallback(() => {
        setEditingId(null);
        setDraft(null);
    }, []);

    /**
     * Persist the draft as a patch of only the fields the operator changed —
     * the backend re-validates same-site/reserved-prefix/loop invariants and a
     * no-op edit closes the row without a needless request. On success the row
     * is replaced with the server's canonical copy (fresh `updatedAt`).
     *
     * @param rule - The original rule the draft is edited from.
     */
    const handleSaveEdit = useCallback(async (rule: IRedirectRuleAdmin) => {
        if (!draft) {
            return;
        }
        const trimmedPattern = draft.pattern.trim();
        const trimmedDestination = draft.destination.trim();
        if (!trimmedPattern || !trimmedDestination) {
            setActionError('Source and destination are required');
            return;
        }
        const trimmedNotes = (draft.notes ?? '').trim();
        const patch: Partial<IRedirectRuleInput> = {};
        if (trimmedPattern !== rule.pattern) patch.pattern = trimmedPattern;
        if (trimmedDestination !== rule.destination) patch.destination = trimmedDestination;
        if (draft.isPrefix !== rule.isPrefix) patch.isPrefix = draft.isPrefix;
        if (draft.permanent !== rule.permanent) patch.permanent = draft.permanent;
        if (trimmedNotes !== (rule.notes ?? '')) patch.notes = trimmedNotes;
        if (Object.keys(patch).length === 0) {
            handleCancelEdit();
            return;
        }
        setActionError(null);
        setSavingEdit(true);
        try {
            const updated = await adminUpdateRedirect(rule.id, patch);
            setRules(prev => (prev ?? []).map(r => (r.id === updated.id ? updated : r)));
            handleCancelEdit();
        } catch (err) {
            setActionError(extractError(err, 'Failed to update redirect'));
        } finally {
            setSavingEdit(false);
        }
    }, [draft, handleCancelEdit]);

    /**
     * Submit the add-rule form. A real form submit, so Enter in any field adds
     * the rule the same way the button does.
     *
     * @param event - The form's submit event, whose page reload is cancelled.
     */
    const handleSubmit = (event: FormEvent<HTMLFormElement>): void => {
        event.preventDefault();
        void handleCreate();
    };

    const activeCount = rules?.filter(rule => rule.enabled).length ?? 0;
    const meta = loading
        ? 'Loading…'
        : `${(rules?.length ?? 0).toLocaleString()} rules, ${activeCount.toLocaleString()} active. Live within a minute of saving.`;

    return (
        <Panel title="URL redirects" titleAs="h2" meta={meta}>
            <div className={styles.body}>
                <AboutDetails summary="How redirect rules work">
                    <p>
                        301/302 redirects for legacy URLs. When a page moves, add a rule so the old path
                        forwards to the new one instead of returning a 404 &mdash; this recovers the crawl
                        equity Google holds for the old URL. Rules are served to the edge middleware and go
                        live within a minute of saving; no deploy is needed.
                    </p>
                    <p>
                        A <strong>prefix</strong> rule also matches sub-paths (<code>/old</code> catches{' '}
                        <code>/old/anything</code>); an <strong>exact</strong> rule matches only the path
                        itself.
                    </p>
                </AboutDetails>

                <form className={styles.form} onSubmit={handleSubmit}>
                    <Field label="Source path" htmlFor="redirect-source">
                        <Input
                            id="redirect-source"
                            type="text"
                            size="sm"
                            value={pattern}
                            onChange={e => setPattern(e.target.value)}
                            placeholder="/tron-forum"
                        />
                    </Field>
                    <Field label="Destination path" htmlFor="redirect-destination">
                        <Input
                            id="redirect-destination"
                            type="text"
                            size="sm"
                            value={destination}
                            onChange={e => setDestination(e.target.value)}
                            placeholder="/forum"
                        />
                    </Field>
                    <Field label="Note (optional)" htmlFor="redirect-notes">
                        <Input
                            id="redirect-notes"
                            type="text"
                            size="sm"
                            value={notes}
                            onChange={e => setNotes(e.target.value)}
                            placeholder="Why this redirect exists"
                        />
                    </Field>
                    <div className={styles.options}>
                        <label className={styles.checkbox}>
                            <input type="checkbox" checked={isPrefix} onChange={e => setIsPrefix(e.target.checked)} />
                            Prefix
                        </label>
                        <label className={styles.checkbox}>
                            <input type="checkbox" checked={permanent} onChange={e => setPermanent(e.target.checked)} />
                            301
                        </label>
                        <Button type="submit" size="sm" loading={creating}>
                            <Plus size={16} aria-hidden="true" /> Add
                        </Button>
                    </div>
                </form>

                {formError && <div className={styles.error} role="alert">{formError}</div>}
                {actionError && <div className={styles.error} role="alert">{actionError}</div>}
                {loadError && <div className={styles.error} role="alert">{loadError}</div>}

                {loading ? (
                    <p className={styles.message}>Loading redirects…</p>
                ) : rules && rules.length > 0 ? (
                    <Table variant="compact" flush className={styles.dense_table}>
                        <Thead>
                            <Tr>
                                <Th scope="col">Source</Th>
                                <Th scope="col">Destination</Th>
                                <Th scope="col" width="shrink">Type</Th>
                                <Th scope="col" width="shrink">Status</Th>
                                <Th scope="col" width="shrink">Updated</Th>
                                <Th scope="col" width="shrink" aria-label="Actions" />
                            </Tr>
                        </Thead>
                        <Tbody>
                            {rules.map(rule => {
                                const rowDraft = editingId === rule.id ? draft : null;
                                return (
                                    <Tr key={rule.id} className={rule.enabled ? undefined : styles.row_disabled}>
                                        {rowDraft ? (
                                            <>
                                                <Td>
                                                    <div className={styles.edit_stack}>
                                                        <Input
                                                            type="text"
                                                            size="xs"
                                                            value={rowDraft.pattern}
                                                            onChange={e => setDraft(d => (d ? { ...d, pattern: e.target.value } : d))}
                                                            placeholder="/tron-forum"
                                                            aria-label="Source path"
                                                            disabled={savingEdit}
                                                        />
                                                        <Input
                                                            type="text"
                                                            size="xs"
                                                            value={rowDraft.notes ?? ''}
                                                            onChange={e => setDraft(d => (d ? { ...d, notes: e.target.value } : d))}
                                                            placeholder="Note (optional)"
                                                            aria-label="Note"
                                                            disabled={savingEdit}
                                                        />
                                                    </div>
                                                </Td>
                                                <Td>
                                                    <Input
                                                        type="text"
                                                        size="xs"
                                                        value={rowDraft.destination}
                                                        onChange={e => setDraft(d => (d ? { ...d, destination: e.target.value } : d))}
                                                        placeholder="/forum"
                                                        aria-label="Destination path"
                                                        disabled={savingEdit}
                                                    />
                                                </Td>
                                                <Td>
                                                    <div className={styles.edit_stack}>
                                                        <label className={styles.checkbox}>
                                                            <input
                                                                type="checkbox"
                                                                checked={rowDraft.isPrefix ?? true}
                                                                onChange={e => setDraft(d => (d ? { ...d, isPrefix: e.target.checked } : d))}
                                                                disabled={savingEdit}
                                                            />
                                                            prefix
                                                        </label>
                                                        <label className={styles.checkbox}>
                                                            <input
                                                                type="checkbox"
                                                                checked={rowDraft.permanent ?? true}
                                                                onChange={e => setDraft(d => (d ? { ...d, permanent: e.target.checked } : d))}
                                                                disabled={savingEdit}
                                                            />
                                                            301
                                                        </label>
                                                    </div>
                                                </Td>
                                                <Td>
                                                    <Badge size="xs" tone={rule.enabled ? 'success' : 'neutral'}>
                                                        {rule.enabled ? 'active' : 'disabled'}
                                                    </Badge>
                                                </Td>
                                                <Td muted className={styles.nowrap}>
                                                    <ClientTime date={rule.updatedAt} format="date" />
                                                </Td>
                                                <Td>
                                                    <div className={styles.actions}>
                                                        <IconButton
                                                            size="sm"
                                                            variant="success"
                                                            onClick={() => void handleSaveEdit(rule)}
                                                            disabled={savingEdit}
                                                            aria-label="Save changes"
                                                            title="Save"
                                                        >
                                                            <Check size={16} aria-hidden="true" />
                                                        </IconButton>
                                                        <IconButton
                                                            size="sm"
                                                            onClick={handleCancelEdit}
                                                            disabled={savingEdit}
                                                            aria-label="Cancel edit"
                                                            title="Cancel"
                                                        >
                                                            <X size={16} aria-hidden="true" />
                                                        </IconButton>
                                                    </div>
                                                </Td>
                                            </>
                                        ) : (
                                            <>
                                                <Td>
                                                    <code className={styles.path}>{rule.pattern}</code>
                                                    {rule.notes && <span className={styles.note}>{rule.notes}</span>}
                                                </Td>
                                                <Td>
                                                    <span className={styles.dest}>
                                                        <ArrowRight size={14} aria-hidden="true" />
                                                        <code className={styles.path}>{rule.destination}</code>
                                                    </span>
                                                </Td>
                                                <Td>
                                                    <span className={styles.badges}>
                                                        <Badge size="xs" tone="neutral">{rule.isPrefix ? 'prefix' : 'exact'}</Badge>
                                                        <Badge size="xs" tone={rule.permanent ? 'info' : 'neutral'}>
                                                            {rule.permanent ? '301' : '302'}
                                                        </Badge>
                                                    </span>
                                                </Td>
                                                <Td>
                                                    <Badge size="xs" tone={rule.enabled ? 'success' : 'neutral'}>
                                                        {rule.enabled ? 'active' : 'disabled'}
                                                    </Badge>
                                                </Td>
                                                <Td muted className={styles.nowrap}>
                                                    <ClientTime date={rule.updatedAt} format="date" />
                                                </Td>
                                                <Td>
                                                    <div className={styles.actions}>
                                                        <IconButton
                                                            size="sm"
                                                            variant="primary"
                                                            onClick={() => handleStartEdit(rule)}
                                                            disabled={editingId !== null}
                                                            aria-label="Edit redirect"
                                                            title="Edit"
                                                        >
                                                            <Pencil size={16} aria-hidden="true" />
                                                        </IconButton>
                                                        <IconButton
                                                            size="sm"
                                                            variant="primary"
                                                            onClick={() => handleToggle(rule)}
                                                            disabled={editingId !== null}
                                                            aria-label={rule.enabled ? 'Disable redirect' : 'Enable redirect'}
                                                            title={rule.enabled ? 'Disable' : 'Enable'}
                                                        >
                                                            {rule.enabled
                                                                ? <Power size={16} aria-hidden="true" />
                                                                : <PowerOff size={16} aria-hidden="true" />}
                                                        </IconButton>
                                                        <IconButton
                                                            size="sm"
                                                            variant="danger"
                                                            onClick={() => handleDelete(rule)}
                                                            disabled={editingId !== null}
                                                            aria-label="Delete redirect"
                                                            title="Delete"
                                                        >
                                                            <Trash2 size={16} aria-hidden="true" />
                                                        </IconButton>
                                                    </div>
                                                </Td>
                                            </>
                                        )}
                                    </Tr>
                                );
                            })}
                        </Tbody>
                    </Table>
                ) : (
                    !loadError && <p className={styles.message}>No redirects yet. Add one above.</p>
                )}
            </div>
        </Panel>
    );
}
