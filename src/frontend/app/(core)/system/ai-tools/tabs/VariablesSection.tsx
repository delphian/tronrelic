'use client';

/**
 * @fileoverview Variables section of the Registry tab — every prompt variable
 * (`{%name%}` token) the AI provider expands into a prompt. Built-in `dynamic`
 * variables (code resolvers) can only be classified; admin-authored `static`
 * variables support full create/edit/delete. Classification matters for security:
 * marking a variable `secret` feeds the lethal-trifecta detector's private-data
 * leg, so every mutation calls `onChanged` to refresh the page's trifecta banner.
 *
 * Admin surface (behind `requireAdmin`), so it follows the sibling tabs'
 * client-fetch pattern rather than SSR — a loading line on a user-opened section
 * is acceptable here.
 */

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Pencil, Plus, Trash2, X } from 'lucide-react';
import type { AiToolSensitivity, IPromptVariableInfo } from '@/types';
import { Stack } from '../../../../../components/layout';
import { Badge } from '../../../../../components/ui/Badge';
import { Button } from '../../../../../components/ui/Button';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { useToast } from '../../../../../components/ui/ToastProvider';
import {
    listVariables,
    createVariable,
    updateVariable,
    deleteVariable,
    classifyVariable
} from '../../../../../modules/ai-tools';
import { CollapsibleSection } from '../components/CollapsibleSection';
import styles from '../page.module.scss';

/** Sensitivity options offered in the classification dropdown. */
const SENSITIVITIES: AiToolSensitivity[] = ['public', 'internal', 'secret'];

/** Badge tone per sensitivity — `secret` reads as the riskiest (danger). */
const SENSITIVITY_TONE: Record<AiToolSensitivity, 'neutral' | 'warning' | 'danger'> = {
    public: 'neutral',
    internal: 'warning',
    secret: 'danger'
};

/** Empty create/edit form state. */
const EMPTY_FORM = { name: '', category: '', description: '', content: '', sensitivity: 'secret' as AiToolSensitivity };

/**
 * Variables management section.
 *
 * @param props.onChanged - Called after any mutation so the page refreshes the
 *                          trifecta banner (a `secret` variable can form the leg).
 * @returns The section.
 */
export function VariablesSection({ onChanged }: { onChanged: () => void }) {
    const [variables, setVariables] = useState<IPromptVariableInfo[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyName, setBusyName] = useState<string | null>(null);
    const [editingName, setEditingName] = useState<string | null>(null);
    const [formOpen, setFormOpen] = useState(false);
    const [form, setForm] = useState(EMPTY_FORM);
    const [saving, setSaving] = useState(false);
    const { push } = useToast();

    const load = useCallback(async () => {
        try {
            setVariables(await listVariables());
            setError(null);
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to load variables');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { void load(); }, [load]);

    const handleClassify = useCallback(async (name: string, sensitivity: AiToolSensitivity) => {
        setBusyName(name);
        try {
            await classifyVariable(name, sensitivity);
            await load();
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Classify failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusyName(null);
        }
    }, [load, onChanged, push]);

    const handleDelete = useCallback(async (name: string) => {
        setBusyName(name);
        try {
            await deleteVariable(name);
            await load();
            onChanged();
        } catch (err) {
            push({ tone: 'danger', title: 'Delete failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setBusyName(null);
        }
    }, [load, onChanged, push]);

    const openCreate = useCallback(() => {
        setEditingName(null);
        setForm(EMPTY_FORM);
        setFormOpen(true);
    }, []);

    const openEdit = useCallback((variable: IPromptVariableInfo) => {
        setEditingName(variable.name);
        setForm({
            name: variable.name,
            category: variable.category,
            description: variable.description,
            content: '',
            sensitivity: variable.sensitivity
        });
        setFormOpen(true);
    }, []);

    const closeForm = useCallback(() => {
        setFormOpen(false);
        setEditingName(null);
        setForm(EMPTY_FORM);
    }, []);

    const handleSubmit = useCallback(async () => {
        setSaving(true);
        try {
            if (editingName) {
                await updateVariable(editingName, {
                    description: form.description,
                    category: form.category,
                    content: form.content,
                    sensitivity: form.sensitivity
                });
            } else {
                await createVariable({
                    name: form.name,
                    description: form.description,
                    category: form.category,
                    content: form.content,
                    sensitivity: form.sensitivity
                });
            }
            await load();
            onChanged();
            closeForm();
        } catch (err) {
            push({ tone: 'danger', title: 'Save failed', description: err instanceof Error ? err.message : String(err) });
        } finally {
            setSaving(false);
        }
    }, [editingName, form, load, onChanged, closeForm, push]);

    const secretCount = variables.filter(v => v.sensitivity === 'secret').length;
    const staticCount = variables.filter(v => v.kind === 'static').length;
    const summary = loading
        ? 'Loading…'
        : `${variables.length} variables · ${secretCount} secret · ${staticCount} custom`;

    return (
        <CollapsibleSection title="Variables" summary={summary}>
            <Stack gap="md">
                <p className={styles.tool_desc}>
                    Prompt variables expand into a prompt wherever <code>{'{%name%}'}</code> appears. Built-in
                    variables can be reclassified; custom variables are admin-authored constants. Marking a
                    variable <strong>secret</strong> counts it toward the lethal-trifecta check.
                </p>

                {error && (
                    <div className="alert" role="alert">
                        <AlertCircle size={16} style={{ color: 'var(--color-danger)', verticalAlign: 'text-bottom' }} /> {error}
                    </div>
                )}

                <div>
                    {formOpen
                        ? (
                            <div className={styles.section_body}>
                                <Stack gap="sm">
                                    <strong>{editingName ? `Edit ${editingName}` : 'New custom variable'}</strong>
                                    {!editingName && (
                                        <input
                                            className={styles.filter_select}
                                            placeholder="name (lowercase-kebab, used as {%name%})"
                                            value={form.name}
                                            onChange={e => setForm({ ...form, name: e.target.value })}
                                            aria-label="Variable name"
                                        />
                                    )}
                                    <input
                                        className={styles.filter_select}
                                        placeholder="category"
                                        value={form.category}
                                        onChange={e => setForm({ ...form, category: e.target.value })}
                                        aria-label="Variable category"
                                    />
                                    <input
                                        className={styles.filter_select}
                                        placeholder="description"
                                        value={form.description}
                                        onChange={e => setForm({ ...form, description: e.target.value })}
                                        aria-label="Variable description"
                                    />
                                    <textarea
                                        className={styles.curation_textarea}
                                        placeholder="content (the text spliced into the prompt)"
                                        value={form.content}
                                        onChange={e => setForm({ ...form, content: e.target.value })}
                                        aria-label="Variable content"
                                        rows={4}
                                    />
                                    <select
                                        className={styles.filter_select}
                                        value={form.sensitivity}
                                        onChange={e => setForm({ ...form, sensitivity: e.target.value as AiToolSensitivity })}
                                        aria-label="Variable sensitivity"
                                    >
                                        {SENSITIVITIES.map(s => <option key={s} value={s}>{s}</option>)}
                                    </select>
                                    <Stack gap="sm" direction="horizontal">
                                        <Button variant="primary" size="sm" onClick={() => void handleSubmit()} disabled={saving}>
                                            {saving ? 'Saving…' : editingName ? 'Save changes' : 'Create variable'}
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
                                <Plus size={16} /> New custom variable
                            </Button>
                        )}
                </div>

                {!loading && variables.length === 0
                    ? <div className={styles.placeholder}>No variables are registered.</div>
                    : (
                        <div className="table-scroll">
                            <Table>
                                <Thead>
                                    <Tr>
                                        <Th>Variable</Th>
                                        <Th width="shrink">Category</Th>
                                        <Th width="shrink">Kind</Th>
                                        <Th width="shrink">Sensitivity</Th>
                                        <Th width="shrink">Actions</Th>
                                    </Tr>
                                </Thead>
                                <Tbody>
                                    {variables.map(variable => (
                                        <Tr key={variable.name}>
                                            <Td>
                                                <div className={styles.tool_name}>{variable.pattern}</div>
                                                <div className={styles.tool_desc}>{variable.description}</div>
                                            </Td>
                                            <Td muted>{variable.category}</Td>
                                            <Td>
                                                <Badge tone={variable.kind === 'static' ? 'info' : 'neutral'}>
                                                    {variable.kind === 'static' ? 'custom' : 'built-in'}
                                                </Badge>
                                            </Td>
                                            <Td>
                                                <select
                                                    className={styles.filter_select}
                                                    value={variable.sensitivity}
                                                    onChange={e => void handleClassify(variable.name, e.target.value as AiToolSensitivity)}
                                                    disabled={busyName === variable.name}
                                                    aria-label={`Classify ${variable.name}`}
                                                >
                                                    {SENSITIVITIES.map(s => <option key={s} value={s}>{s}</option>)}
                                                </select>
                                            </Td>
                                            <Td>
                                                {variable.editable && (
                                                    <Stack gap="sm" direction="horizontal">
                                                        <Button
                                                            variant="ghost"
                                                            size="xs"
                                                            onClick={() => openEdit(variable)}
                                                            disabled={busyName === variable.name}
                                                            aria-label={`Edit ${variable.name}`}
                                                        >
                                                            <Pencil size={14} />
                                                        </Button>
                                                        <Button
                                                            variant="danger"
                                                            size="xs"
                                                            onClick={() => void handleDelete(variable.name)}
                                                            disabled={busyName === variable.name}
                                                            aria-label={`Delete ${variable.name}`}
                                                        >
                                                            <Trash2 size={14} />
                                                        </Button>
                                                    </Stack>
                                                )}
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
