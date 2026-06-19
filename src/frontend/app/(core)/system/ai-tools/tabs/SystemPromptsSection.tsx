'use client';

/**
 * @fileoverview System Prompts section of the Registry tab — the core-managed
 * system prompts injected into every AI query. One always-on `master` prompt
 * (may be blank) plus any number of audience-scoped `additional` prompts, each
 * targeting user ids (any-of) and/or groups (all-of), the two filters combined
 * with OR. Bodies support `{%name%}` variables, expanded by core before
 * injection. The composed result rides `IAiQueryOptions.injectedSystemPrompt`
 * after the provider's security clause and before the provider's own prompt.
 *
 * Admin surface (behind `requireAdmin`), so it follows the sibling sections'
 * client-fetch pattern rather than SSR — a loading line on a user-opened section
 * is acceptable here.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { IUserGroup } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Badge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Switch } from '../../../../../components/ui/Switch';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { useToast } from '../../../../../components/ui/ToastProvider';
import {
    getSystemPrompts,
    setMasterSystemPrompt,
    saveSystemPrompt,
    deleteSystemPrompt,
    listUserGroups,
    type ISystemPromptView
} from '../../../../../modules/ai-tools';
import { CollapsibleSection } from '../components/CollapsibleSection';
import styles from '../page.module.scss';

/** Editable shape of the additional-prompt create/edit form. */
interface IPromptForm {
    name: string;
    content: string;
    userIds: string[];
    groups: string[];
    order: number;
    enabled: boolean;
}

/** Empty create/edit form state. */
const EMPTY_FORM: IPromptForm = { name: '', content: '', userIds: [], groups: [], order: 0, enabled: true };

/**
 * System prompts management section.
 *
 * @returns The section.
 */
export function SystemPromptsSection() {
    const [master, setMaster] = useState('');
    const [additional, setAdditional] = useState<ISystemPromptView[]>([]);
    const [groups, setGroups] = useState<IUserGroup[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [savingMaster, setSavingMaster] = useState(false);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState<IPromptForm>(EMPTY_FORM);
    const [userIdDraft, setUserIdDraft] = useState('');
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    /**
     * Load the master prompt, the additional prompts, and the group list that
     * backs the audience-target picker. Memoized so the mount effect runs it once;
     * also re-run after a delete to refresh the table.
     */
    const load = useCallback(async () => {
        try {
            const [prompts, userGroups] = await Promise.all([getSystemPrompts(), listUserGroups()]);
            setMaster(prompts.master);
            setAdditional(prompts.additional);
            setGroups(userGroups);
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load system prompts');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    /**
     * Persist the master prompt and reflect the server-normalized value back into
     * state, toasting the outcome. A blank master is valid — it disables the
     * always-on contribution without removing the concept.
     */
    const handleSaveMaster = useCallback(async () => {
        setSavingMaster(true);
        try {
            const saved = await setMasterSystemPrompt(master);
            setMaster(saved);
            push({ tone: 'success', title: 'Master prompt saved' });
        } catch (err) {
            push({ tone: 'danger', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setSavingMaster(false);
        }
    }, [master, push]);

    /** Open a blank create form, clearing any prior edit target and draft state. */
    const openCreate = useCallback(() => {
        setEditingId(null);
        setForm(EMPTY_FORM);
        setUserIdDraft('');
        setFormOpen(true);
    }, []);

    /**
     * Open the form pre-filled from an existing prompt. Array fields are copied so
     * in-form edits don't mutate the loaded row before the user saves.
     *
     * @param prompt - The prompt to edit.
     */
    const openEdit = useCallback((prompt: ISystemPromptView) => {
        setEditingId(prompt.id);
        setForm({
            name: prompt.name,
            content: prompt.content,
            userIds: [...prompt.userIds],
            groups: [...prompt.groups],
            order: prompt.order,
            enabled: prompt.enabled
        });
        setUserIdDraft('');
        setFormOpen(true);
    }, []);

    /** Close the form and reset all create/edit draft state. */
    const closeForm = useCallback(() => {
        setFormOpen(false);
        setEditingId(null);
        setForm(EMPTY_FORM);
        setUserIdDraft('');
    }, []);

    /**
     * Append the drafted user id to the form's any-of target list, ignoring blanks
     * and duplicates, then clear the draft input.
     */
    const addUserId = useCallback(() => {
        const id = userIdDraft.trim();
        if (id) {
            setForm(current => current.userIds.includes(id) ? current : { ...current, userIds: [...current.userIds, id] });
        }
        setUserIdDraft('');
    }, [userIdDraft]);

    /**
     * Drop a user id from the form's any-of target list.
     *
     * @param id - The user id to remove.
     */
    const removeUserId = useCallback((id: string) => {
        setForm(current => ({ ...current, userIds: current.userIds.filter(existing => existing !== id) }));
    }, []);

    /**
     * Toggle membership of a group in the form's all-of target list.
     *
     * @param groupId - The group id to add or remove.
     */
    const toggleGroup = useCallback((groupId: string) => {
        setForm(current => ({
            ...current,
            groups: current.groups.includes(groupId)
                ? current.groups.filter(existing => existing !== groupId)
                : [...current.groups, groupId]
        }));
    }, []);

    /**
     * Create or update the additional prompt from the form (an editing id present
     * means update), refresh the section from the returned snapshot, and close the
     * form on success; toast the error otherwise.
     */
    const handleSubmit = useCallback(async () => {
        setSaving(true);
        try {
            const result = await saveSystemPrompt({
                id: editingId ?? undefined,
                name: form.name,
                content: form.content,
                userIds: form.userIds,
                groups: form.groups,
                order: form.order,
                enabled: form.enabled
            });
            setMaster(result.master);
            setAdditional(result.additional);
            closeForm();
        } catch (err) {
            push({ tone: 'danger', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setSaving(false);
        }
    }, [editingId, form, closeForm, push]);

    /**
     * Flip a prompt's enabled flag inline from the table without opening the form,
     * refreshing the list from the returned snapshot.
     *
     * @param id - The prompt id.
     * @param enabled - The new enabled state.
     */
    const handleToggleEnabled = useCallback(async (id: string, enabled: boolean) => {
        setBusyId(id);
        try {
            const result = await saveSystemPrompt({ id, enabled });
            setAdditional(result.additional);
        } catch (err) {
            push({ tone: 'danger', title: 'Toggle failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusyId(null);
        }
    }, [push]);

    /**
     * Delete a prompt, then reload the section so the table reflects the removal.
     *
     * @param id - The prompt id to delete.
     */
    const handleDelete = useCallback(async (id: string) => {
        setBusyId(id);
        try {
            await deleteSystemPrompt(id);
            await load();
        } catch (err) {
            push({ tone: 'danger', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusyId(null);
        }
    }, [load, push]);

    /** Resolve a group id to its human label for read-only display. */
    const groupLabel = useCallback(
        (id: string) => groups.find(group => group.id === id)?.name ?? id,
        [groups]
    );

    const audienceValid = form.userIds.length > 0 || form.groups.length > 0;
    const summary = loading
        ? 'Loading…'
        : `${additional.length} additional · master ${master.trim() ? 'set' : 'blank'}`;

    return (
        <CollapsibleSection title="System Prompts" summary={summary}>
            <Stack gap="md">
                <p className={styles.tool_desc}>
                    System prompts are injected into every AI query. The <strong>master</strong> prompt always
                    applies (leave it blank to contribute nothing). Each <strong>additional</strong> prompt applies
                    when the querying user matches its user ids <em>or</em> belongs to all of its groups. Bodies
                    expand <code>{'{%name%}'}</code> variables.
                </p>

                {error && (
                    <div className="alert" role="alert">
                        <AlertCircle size={16} style={{ color: 'var(--color-danger)', verticalAlign: 'text-bottom' }} /> {error}
                    </div>
                )}

                <div className={styles.section_body}>
                    <Stack gap="sm">
                        <strong>Master prompt</strong>
                        <textarea
                            className={styles.curation_textarea}
                            placeholder="Always-injected system prompt (may be left blank)"
                            value={master}
                            onChange={e => setMaster(e.target.value)}
                            aria-label="Master system prompt"
                            rows={5}
                        />
                        <div>
                            <Button variant="primary" size="sm" onClick={() => void handleSaveMaster()} disabled={savingMaster}>
                                {savingMaster ? 'Saving…' : 'Save master prompt'}
                            </Button>
                        </div>
                    </Stack>
                </div>

                <div>
                    {formOpen
                        ? (
                            <div className={styles.section_body}>
                                <Stack gap="sm">
                                    <strong>{editingId ? `Edit ${form.name || 'prompt'}` : 'New system prompt'}</strong>
                                    <input
                                        className={styles.filter_select}
                                        placeholder="name (admin label)"
                                        value={form.name}
                                        onChange={e => setForm({ ...form, name: e.target.value })}
                                        aria-label="Prompt name"
                                    />
                                    <textarea
                                        className={styles.curation_textarea}
                                        placeholder="prompt body (supports {%name%} variables)"
                                        value={form.content}
                                        onChange={e => setForm({ ...form, content: e.target.value })}
                                        aria-label="Prompt content"
                                        rows={5}
                                    />

                                    <span className={styles.field_label}>Target user ids (any of)</span>
                                    <Stack gap="sm" direction="horizontal">
                                        <input
                                            className={styles.filter_select}
                                            placeholder="Better Auth user id"
                                            value={userIdDraft}
                                            onChange={e => setUserIdDraft(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addUserId(); } }}
                                            aria-label="Add target user id"
                                        />
                                        <Button variant="secondary" size="sm" onClick={addUserId} disabled={!userIdDraft.trim()}>
                                            <Plus size={16} /> Add
                                        </Button>
                                    </Stack>
                                    {form.userIds.length > 0 && (
                                        <div className={styles.audience_chips}>
                                            {form.userIds.map(id => (
                                                <span key={id} className={styles.audience_chip}>
                                                    {id}
                                                    <button
                                                        type="button"
                                                        className={styles.audience_chip_remove}
                                                        onClick={() => removeUserId(id)}
                                                        aria-label={`Remove user id ${id}`}
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </span>
                                            ))}
                                        </div>
                                    )}

                                    <span className={styles.field_label}>Target groups (member of all selected)</span>
                                    {groups.length === 0
                                        ? <span className={styles.tool_desc}>No groups defined.</span>
                                        : (
                                            <div className={styles.group_checks}>
                                                {groups.map(group => (
                                                    <label key={group.id} className={styles.check_label}>
                                                        <input
                                                            type="checkbox"
                                                            checked={form.groups.includes(group.id)}
                                                            onChange={() => toggleGroup(group.id)}
                                                        />
                                                        {group.name} <span className="text-muted">({group.id})</span>
                                                    </label>
                                                ))}
                                            </div>
                                        )}

                                    <span className={styles.field_label}>Order</span>
                                    <input
                                        className={styles.filter_select}
                                        type="number"
                                        value={form.order}
                                        onChange={e => setForm({ ...form, order: Number(e.target.value) || 0 })}
                                        aria-label="Injection order"
                                    />

                                    {!audienceValid && (
                                        <span className={styles.tool_desc}>
                                            Add at least one user id or group — the master prompt already covers everyone.
                                        </span>
                                    )}

                                    <Stack gap="sm" direction="horizontal">
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => void handleSubmit()}
                                            disabled={saving || !form.name.trim() || !form.content.trim() || !audienceValid}
                                        >
                                            {saving ? 'Saving…' : editingId ? 'Save changes' : 'Create prompt'}
                                        </Button>
                                        <Button variant="ghost" size="sm" onClick={closeForm} disabled={saving}>
                                            <X size={16} /> Cancel
                                        </Button>
                                    </Stack>
                                </Stack>
                            </div>
                        )
                        : (
                            <Button variant="secondary" size="sm" onClick={openCreate}>
                                <Plus size={16} /> New system prompt
                            </Button>
                        )}
                </div>

                {!loading && additional.length === 0
                    ? <div className={styles.placeholder}>No additional system prompts.</div>
                    : (
                        <div className="table-scroll">
                            <Table>
                                <Thead>
                                    <Tr>
                                        <Th>Prompt</Th>
                                        <Th>Audience</Th>
                                        <Th width="shrink">Order</Th>
                                        <Th width="shrink">Enabled</Th>
                                        <Th width="shrink">Actions</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {additional.map(prompt => (
                                        <Tr key={prompt.id}>
                                            <Td>
                                                <div className={styles.tool_name}>{prompt.name}</div>
                                                <div className={styles.tool_desc}>{prompt.content}</div>
                                            </Td>
                                            <Td>
                                                <div className={styles.audience_chips}>
                                                    {prompt.userIds.map(id => (
                                                        <Badge key={`u-${id}`} tone="neutral">{id}</Badge>
                                                    ))}
                                                    {prompt.groups.map(id => (
                                                        <Badge key={`g-${id}`} tone="info">{groupLabel(id)}</Badge>
                                                    ))}
                                                </div>
                                            </Td>
                                            <Td muted>{prompt.order}</Td>
                                            <Td>
                                                <Switch
                                                    on={prompt.enabled}
                                                    onChange={(next) => handleToggleEnabled(prompt.id, next)}
                                                    disabled={busyId === prompt.id}
                                                    aria-label={`${prompt.enabled ? 'Disable' : 'Enable'} ${prompt.name}`}
                                                />
                                            </Td>
                                            <Td>
                                                <Stack gap="sm" direction="horizontal">
                                                    <Button
                                                        variant="ghost"
                                                        size="xs"
                                                        onClick={() => openEdit(prompt)}
                                                        disabled={busyId === prompt.id}
                                                        aria-label={`Edit ${prompt.name}`}
                                                    >
                                                        <Pencil size={14} />
                                                    </Button>
                                                    <Button
                                                        variant="danger"
                                                        size="xs"
                                                        onClick={() => void handleDelete(prompt.id)}
                                                        disabled={busyId === prompt.id}
                                                        aria-label={`Delete ${prompt.name}`}
                                                    >
                                                        <Trash2 size={14} />
                                                    </Button>
                                                </Stack>
                                            </Td>
                                        </Tr>
                                    ))}
                                </Tbody>
                            </Table>
                        </div>
                    )}
            </Stack>
        </CollapsibleSection>
    );
}
