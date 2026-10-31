'use client';

/**
 * BotRules Settings Panel
 *
 * Manages the operator's rules for identifying automated traffic. Some browser
 * fleets run real Chrome, hide the automation flag, and send a stock browser
 * identifier, so the built-in classifier counts them as visitors. A rule
 * describes such traffic from its data — network, country, browser build,
 * paths, referrer, or a page load and JavaScript report arriving from
 * different networks — and labels matching events as a bot when they are
 * recorded. It replaced the ASN-only automated-network list.
 *
 * A rule changes only the analytics label; matched visitors are still served
 * every page, logged-in visitors never match, and events recorded before a
 * change keep their label. Monitor mode counts matches without changing labels,
 * so a rule can be watched on real traffic first. Rules an AI agent proposes
 * arrive here as "proposed" after appearing in `/system/curation`.
 *
 * Admin-only panel — no SSR data fetching; admin pages fetch client-side after
 * auth, so the initial load state here is the permitted admin case.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import type { IBotRule, IBotRuleStats, IBotRuleSuggestion } from '@/types';
import { Panel } from '../../../../../components/ui/Panel';
import { Button } from '../../../../../components/ui/Button';
import { Badge } from '../../../../../components/ui/Badge';
import { Switch } from '../../../../../components/ui/Switch';
import { ClientTime } from '../../../../../components/ui/ClientTime';
import { ConfirmDialog } from '../../../../../components/ui/ConfirmDialog';
import { Table, Thead, Tbody, Tr, Th, Td } from '../../../../../components/ui/Table';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { AboutDetails } from '../AboutDetails';
import { adminDeleteBotRule, adminGetBotRules, adminGetBotRuleSuggestions, adminUpdateBotRule } from '../../../api/client';
import { BotRuleForm, botRuleErrorMessage } from './BotRuleForm';
import { BotRuleSuggestions } from './BotRuleSuggestions';
import {
    botRuleFormFromRule,
    botRuleFormFromSuggestion,
    describeBotRuleConditions,
    emptyBotRuleForm,
    type IBotRuleFormState
} from './botRuleFormState';
import styles from './BotRules.module.scss';

/** What the editor is showing: nothing, a new rule, or one being edited. */
type EditorState = { rule: IBotRule | null; initial: IBotRuleFormState; key: number } | null;

/**
 * Choose the badge tone for a rule's state, so a proposed rule stands out and
 * a labeling rule reads differently from one that only counts.
 *
 * @param rule - The rule.
 * @returns The tone and the text to show.
 */
function statusBadge(rule: IBotRule): { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; text: string } {
    let badge: { tone: 'neutral' | 'info' | 'success' | 'warning' | 'danger'; text: string };
    if (rule.status === 'proposed') {
        badge = { tone: 'warning', text: 'Awaiting review' };
    } else if (rule.status === 'rejected') {
        badge = { tone: 'danger', text: 'Rejected' };
    } else if (rule.expiresAt && Date.parse(rule.expiresAt) <= Date.now()) {
        badge = { tone: 'neutral', text: 'Expired' };
    } else {
        badge = rule.mode === 'label' ? { tone: 'success', text: 'Labeling' } : { tone: 'info', text: 'Monitoring' };
    }
    return badge;
}

/**
 * Admin panel listing every bot rule with its recent match counts, an editor
 * for creating and changing rules, and suggested networks to start from.
 *
 * @returns The rendered bot rules settings card.
 */
export function BotRules() {
    const [rules, setRules] = useState<IBotRule[]>([]);
    const [stats, setStats] = useState<IBotRuleStats[]>([]);
    const [suggestions, setSuggestions] = useState<IBotRuleSuggestion[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [busyId, setBusyId] = useState<string | null>(null);
    const [editor, setEditor] = useState<EditorState>(null);
    const { open, close } = useModal();

    /**
     * Load rules, match counts, and suggestions. Suggestions are secondary, so
     * a failure there leaves the rule list usable.
     */
    const load = useCallback(async (): Promise<void> => {
        try {
            const list = await adminGetBotRules();
            setRules(list.rules);
            setStats(list.stats);
        } catch (err) {
            setError(botRuleErrorMessage(err, 'Failed to load bot rules'));
        }
        try {
            setSuggestions(await adminGetBotRuleSuggestions());
        } catch {
            setSuggestions([]);
        }
        setLoading(false);
    }, []);

    useEffect(() => {
        void load();
    }, [load]);

    const statsById = useMemo(() => new Map(stats.map(s => [s.ruleId, s])), [stats]);

    /**
     * Open the editor. A changing `key` remounts the form so its fields reset
     * when switching from one rule to another.
     *
     * @param rule - The rule to edit, or null for a new one.
     * @param initial - The form's starting values.
     */
    const openEditor = useCallback((rule: IBotRule | null, initial: IBotRuleFormState): void => {
        setEditor(current => ({ rule, initial, key: (current?.key ?? 0) + 1 }));
    }, []);

    /**
     * Close the editor after a save and refresh the list so the new state and
     * counts show.
     */
    const handleSaved = useCallback((): void => {
        setEditor(null);
        void load();
    }, [load]);

    /**
     * Pause or resume a rule from the list without opening the editor.
     *
     * @param rule - The rule to toggle.
     * @param enabled - Its new state.
     */
    const handleToggle = useCallback(async (rule: IBotRule, enabled: boolean): Promise<void> => {
        setError(null);
        setBusyId(rule.id);
        try {
            const updated = await adminUpdateBotRule(rule.id, {
                name: rule.name,
                note: rule.note,
                label: rule.label,
                mode: rule.mode,
                enabled,
                expiresAt: rule.expiresAt,
                conditions: rule.conditions
            });
            setRules(current => current.map(r => (r.id === updated.id ? updated : r)));
        } catch (err) {
            setError(botRuleErrorMessage(err, 'Failed to update the rule'));
        } finally {
            setBusyId(null);
        }
    }, []);

    /**
     * Ask before deleting a rule, then delete it and refresh the list.
     *
     * @param rule - The rule to delete.
     */
    const handleDelete = useCallback((rule: IBotRule): void => {
        const modalId = open({
            title: 'Delete bot rule',
            size: 'sm',
            content: (
                <ConfirmDialog
                    label={rule.name}
                    message="Events it already labeled keep their label. Traffic it matched is counted by the built-in classifier from now on."
                    confirmLabel="Delete"
                    onCancel={() => close(modalId)}
                    onConfirm={
                        /**
                         * Delete once confirmed, then close the dialog either way so a
                         * failure is reported on the panel rather than a stuck dialog.
                         */
                        async () => {
                            try {
                                await adminDeleteBotRule(rule.id);
                                await load();
                            } catch (err) {
                                setError(botRuleErrorMessage(err, 'Failed to delete the rule'));
                            } finally {
                                close(modalId);
                            }
                        }
                    }
                />
            )
        });
    }, [open, close, load]);

    const active = rules.filter(r => r.status === 'active').length;
    const proposed = rules.filter(r => r.status === 'proposed').length;
    const meta = loading
        ? 'Loading…'
        : `${active.toLocaleString()} active${proposed > 0 ? `, ${proposed.toLocaleString()} awaiting review` : ''}`;

    return (
        <Panel
            title="Bot rules"
            meta={meta}
            actions={!editor && (
                <Button type="button" size="sm" variant="secondary" onClick={() => openEditor(null, emptyBotRuleForm())}>
                    <Plus size={16} aria-hidden="true" /> New rule
                </Button>
            )}
        >
            <div className={styles.body}>
                <AboutDetails summary="How bot rules work">
                    <p>
                        A rule labels traffic the built-in classifier counts as human. All of a rule&apos;s set
                        conditions must match; inside a list, any one entry matches, except browser identifier
                        text, where every line must appear. Logged-in visitors never match. A rule in monitor mode
                        only counts what it matches, so watch a new rule for a few days before switching it to
                        label mode. Rules change analytics labels only — matched visitors are still served every
                        page — and apply to traffic recorded from now on. Rules an AI agent proposes wait in
                        Curation and start in monitor mode when approved.
                    </p>
                </AboutDetails>

                {error && <div className={styles.error} role="alert">{error}</div>}

                {editor && (
                    <BotRuleForm
                        key={editor.key}
                        rule={editor.rule}
                        initial={editor.initial}
                        onSaved={handleSaved}
                        onCancel={() => setEditor(null)}
                    />
                )}

                {loading ? (
                    <p className={styles.empty}>Loading bot rules…</p>
                ) : rules.length === 0 ? (
                    <p className={styles.empty}>No rules yet. Traffic is classified by the built-in checks alone.</p>
                ) : (
                    <Table variant="compact">
                        <Thead>
                            <Tr>
                                <Th>Rule</Th>
                                <Th>State</Th>
                                <Th numeric>24h</Th>
                                <Th numeric>7d</Th>
                                <Th>Last match</Th>
                                <Th>On</Th>
                                <Th><span className={styles.visually_hidden}>Actions</span></Th>
                            </Tr>
                        </Thead>
                        <Tbody>
                            {rules.map(rule => {
                                const ruleStats = statsById.get(rule.id);
                                const badge = statusBadge(rule);
                                return (
                                    <Tr key={rule.id}>
                                        <Td className={styles.cell_wrap}>
                                            <span className={styles.rule_name}>{rule.name}</span>
                                            <span className={styles.rule_conditions}>
                                                {describeBotRuleConditions(rule.conditions).join(' · ')} → {rule.label}
                                            </span>
                                            {rule.note && <span className={styles.rule_note}>{rule.note}</span>}
                                        </Td>
                                        <Td><Badge size="sm" tone={badge.tone}>{badge.text}</Badge></Td>
                                        <Td numeric>{(ruleStats?.matches24h ?? 0).toLocaleString()}</Td>
                                        <Td numeric>{(ruleStats?.matches7d ?? 0).toLocaleString()}</Td>
                                        <Td muted>{ruleStats?.lastMatchedAt ? <ClientTime date={ruleStats.lastMatchedAt} format="relative" /> : '—'}</Td>
                                        <Td>
                                            <Switch
                                                size="xs"
                                                on={rule.enabled}
                                                disabled={busyId === rule.id || rule.status !== 'active'}
                                                onChange={next => handleToggle(rule, next)}
                                                aria-label={`${rule.enabled ? 'Pause' : 'Resume'} rule ${rule.name}`}
                                            />
                                        </Td>
                                        <Td>
                                            <span className={styles.row_actions}>
                                                <Button type="button" size="xs" variant="ghost" onClick={() => openEditor(rule, botRuleFormFromRule(rule))} aria-label={`Edit rule ${rule.name}`}>
                                                    <Pencil size={14} aria-hidden="true" />
                                                </Button>
                                                <Button type="button" size="xs" variant="ghost" onClick={() => handleDelete(rule)} aria-label={`Delete rule ${rule.name}`}>
                                                    <Trash2 size={14} aria-hidden="true" />
                                                </Button>
                                            </span>
                                        </Td>
                                    </Tr>
                                );
                            })}
                        </Tbody>
                    </Table>
                )}

                {!loading && (
                    <BotRuleSuggestions
                        suggestions={suggestions}
                        onUse={suggestion => openEditor(null, botRuleFormFromSuggestion(suggestion))}
                    />
                )}
            </div>
        </Panel>
    );
}
