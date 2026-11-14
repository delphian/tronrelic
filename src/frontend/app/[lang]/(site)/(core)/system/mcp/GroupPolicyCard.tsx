'use client';

/**
 * @fileoverview The per-group MCP settings card on the Tools tab of /system/mcp.
 *
 * Shows the settings for the group the admin is managing: whether the group's
 * tools are served at all, its call limits, scrub secrets from results, serve
 * only to listed IP addresses, and allow restricted tools. Each applies to the
 * tools this group grants. Switching on "allow restricted tools" opens a
 * warning that must be confirmed, because it lets the group be granted tools
 * that return secrets or act outside the platform. Switching it off is
 * confirmed too, because it withdraws every restricted tool the group holds,
 * and so is switching the group off, because every member loses its tools.
 */

import { useCallback, useState } from 'react';
import type { IMcpGroup, IMcpGroupLimits, IMcpGroupPolicy, IMcpGroupPolicyPatch } from '@/types';
import { normaliseIpAllowlistEntries } from '@/types';
import { Card } from '../../../../../../components/ui/Card';
import { Grid, Stack } from '../../../../../../components/layout';
import { Button } from '../../../../../../components/ui/Button';
import { Field } from '../../../../../../components/ui/Field';
import { Input } from '../../../../../../components/ui/Input';
import { Switch } from '../../../../../../components/ui/Switch';
import { Textarea } from '../../../../../../components/ui/Textarea';
import { ClientTime } from '../../../../../../components/ui/ClientTime';
import { ConfirmDialog } from '../../../../../../components/ui/ConfirmDialog';
import { useModal } from '../../../../../../components/ui/ModalProvider';
import { useToast } from '../../../../../../components/ui/ToastProvider';
import { updateMcpGroupPolicy } from '../../../../../../modules/mcp';
import styles from './page.module.scss';

/**
 * Props for {@link GroupPolicyCard}.
 */
interface IGroupPolicyCardProps {
    /** The group being managed. The parent keys the card by group id, so local edits reset on a switch. */
    group: IMcpGroup;
    /** How many restricted tools the group holds, named in the warning shown before they are withdrawn. */
    restrictedGrantCount: number;
    /**
     * Receives the stored policy after a change, and how many restricted
     * grants the server withdrew, so the parent can update the group list and
     * reload the tool rows when grants were removed.
     */
    onPolicyChange: (policy: IMcpGroupPolicy, withdrawnRestrictedGrants: number) => void;
}

/**
 * Props for {@link PolicyToggle}.
 */
interface IPolicyToggleProps {
    /** Short name of the setting. */
    label: string;
    /** What the setting does, in one or two sentences. */
    description: string;
    /** Current state. */
    on: boolean;
    /** Whether the switch can be used right now. */
    disabled: boolean;
    /** Called with the requested new state. */
    onChange: (next: boolean) => void;
}

/**
 * One setting: a switch beside its name and explanation. The switch carries
 * the name as its accessible label, so a screen reader announces what it toggles.
 *
 * @param props - {@link IPolicyToggleProps}.
 * @returns The setting row.
 */
function PolicyToggle({ label, description, on, disabled, onChange }: IPolicyToggleProps) {
    return (
        <div className={styles.policy_row}>
            <Switch on={on} onChange={onChange} disabled={disabled} aria-label={label} />
            <div className={styles.policy_text}>
                <div className={styles.policy_label}>{label}</div>
                <div className={styles.tool_meta}>{description}</div>
            </div>
        </div>
    );
}

/** The limit fields, with the label and hint each is edited under. */
const LIMIT_FIELDS: ReadonlyArray<{ key: keyof IMcpGroupLimits; label: string; hint: string }> = [
    { key: 'callsPerMinutePerCaller', label: 'Calls per minute, per caller', hint: 'At most 60, the platform ceiling.' },
    { key: 'callsPerDayPerCaller', label: 'Calls per 24 hours, per caller', hint: 'Counted over 24 hours from a caller\'s first call.' },
    { key: 'callsPerDayGroup', label: 'Calls per 24 hours, whole group', hint: 'Shared by every caller; bounds what the group can cost.' }
];

/** The limit inputs' text, one string per limit, empty for "no limit". */
type LimitDraft = Record<keyof IMcpGroupLimits, string>;

/**
 * Turn stored limits into the text the inputs show.
 *
 * @param limits - The stored limits.
 * @returns One string per limit, empty where no limit is set.
 */
function toDraft(limits: IMcpGroupLimits): LimitDraft {
    return {
        callsPerMinutePerCaller: limits.callsPerMinutePerCaller?.toString() ?? '',
        callsPerDayPerCaller: limits.callsPerDayPerCaller?.toString() ?? '',
        callsPerDayGroup: limits.callsPerDayGroup?.toString() ?? ''
    };
}

/**
 * Turn the inputs' text into limits to send. An empty input clears the limit;
 * anything else is sent as a number for the server to validate, which reports
 * every bad value at once.
 *
 * @param draft - The inputs' text.
 * @returns The limits to send.
 */
function fromDraft(draft: LimitDraft): IMcpGroupLimits {
    const parse = (text: string): number | null => (text.trim() === '' ? null : Number(text.trim()));
    return {
        callsPerMinutePerCaller: parse(draft.callsPerMinutePerCaller),
        callsPerDayPerCaller: parse(draft.callsPerDayPerCaller),
        callsPerDayGroup: parse(draft.callsPerDayGroup)
    };
}

/**
 * Turn the allowlist textarea into entries, one per line, cleaned with the
 * same shared function the server stores the list with. After a save the
 * textarea then matches the stored list and the Save button goes back to
 * disabled, even when the admin pasted a line twice.
 */
function parseEntries(text: string): string[] {
    return normaliseIpAllowlistEntries(text.split('\n'));
}

/**
 * Render the settings card for one group.
 *
 * @param props - {@link IGroupPolicyCardProps}.
 * @returns The card.
 */
export function GroupPolicyCard({ group, restrictedGrantCount, onPolicyChange }: IGroupPolicyCardProps) {
    const policy = group.policy;
    const [working, setWorking] = useState(false);
    const [draft, setDraft] = useState(policy.ipAllowlist.join('\n'));
    const [listError, setListError] = useState('');
    const [limitDraft, setLimitDraft] = useState<LimitDraft>(toDraft(policy.limits));
    const [limitError, setLimitError] = useState('');
    const { open, close } = useModal();
    const { push } = useToast();

    const savedList = policy.ipAllowlist.join('\n');
    const draftDirty = parseEntries(draft).join('\n') !== savedList;
    const limitsDirty = JSON.stringify(fromDraft(limitDraft)) !== JSON.stringify(policy.limits);

    /**
     * Send one change to the server and report the outcome. An allowlist
     * refusal is shown under the textarea rather than as a toast, so the admin
     * sees which entries to fix beside the entries themselves.
     *
     * @param change - The settings to change.
     * @param success - Toast title shown when the change is stored.
     * @returns True when the change was stored.
     */
    const apply = useCallback(async (change: IMcpGroupPolicyPatch, success: string): Promise<boolean> => {
        setWorking(true);
        let stored = false;
        try {
            const result = await updateMcpGroupPolicy(group.id, change);
            onPolicyChange(result.policy, result.withdrawnRestrictedGrants);
            setListError('');
            setLimitError('');
            push({ tone: 'success', title: success });
            stored = true;
        } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            if (change.ipAllowlist) {
                setListError(message);
            } else if (change.limits) {
                setLimitError(message);
            } else {
                push({ tone: 'danger', title: `Could not change ${group.name}`, description: message });
            }
        } finally {
            setWorking(false);
        }
        return stored;
    }, [group.id, group.name, onPolicyChange, push]);

    /**
     * Ask for confirmation, then switch "allow restricted tools" on or off.
     *
     * @param next - The requested state.
     */
    const confirmRestricted = useCallback((next: boolean): void => {
        const modalId = open({
            title: next ? 'Allow restricted tools' : 'Stop allowing restricted tools',
            content: (
                <ConfirmDialog
                    label={group.name}
                    confirmLabel={next ? 'Allow restricted tools' : 'Withdraw and turn off'}
                    message={next ? (
                        <>
                            Members of <strong>{group.name}</strong> who are also in mcp-users could be granted tools that
                            return secret data, change data, reach outside TronRelic, or spend money. Their own AI client can
                            send anything it receives to any website, and text an attacker planted in a result could tell it
                            to. Turn on secret scrubbing and an IP allowlist for this group as well. Continue?
                        </>
                    ) : (
                        <>
                            This withdraws the {restrictedGrantCount} restricted {restrictedGrantCount === 1 ? 'tool' : 'tools'} granted
                            to <strong>{group.name}</strong>. Turning the setting back on later will not restore them. Continue?
                        </>
                    )}
                    onConfirm={
                        async () => {
                            await apply({ allowRestrictedTools: next }, next ? 'Restricted tools allowed' : 'Restricted tools withdrawn');
                            close(modalId);
                        }
                    }
                    onCancel={
                        () => close(modalId)
                    }
                />
            )
        });
    }, [open, close, apply, group.name, restrictedGrantCount]);

    /**
     * Switch the group on at once, or ask for confirmation before switching it
     * off, because every member then loses the tools it grants.
     *
     * @param next - The requested state.
     */
    const confirmEnabled = useCallback((next: boolean): void => {
        if (next) {
            void apply({ enabled: true }, `${group.name} switched on`);
        } else {
            const modalId = open({
                title: `Switch off ${group.name}`,
                content: (
                    <ConfirmDialog
                        label={group.name}
                        confirmLabel="Switch off"
                        message={(
                            <>
                                No caller is served a tool through <strong>{group.name}</strong> until you switch it back on.
                                Its grants, protections, and limits are kept. Continue?
                            </>
                        )}
                        onConfirm={
                            async () => {
                                await apply({ enabled: false }, `${group.name} switched off`);
                                close(modalId);
                            }
                        }
                        onCancel={
                            () => close(modalId)
                        }
                    />
                )
            });
        }
    }, [open, close, apply, group.name]);

    /**
     * Store the edited limits. Validation happens on the server, which reports
     * every bad value at once, under the inputs.
     */
    const saveLimits = useCallback(async (): Promise<void> => {
        const limits = fromDraft(limitDraft);
        if (await apply({ limits }, 'Limits saved')) {
            setLimitDraft(toDraft(limits));
        }
    }, [limitDraft, apply]);

    /**
     * Store the edited allowlist. Validation happens on the server, which
     * reports every bad entry at once.
     */
    const saveList = useCallback(async (): Promise<void> => {
        const entries = parseEntries(draft);
        if (await apply({ ipAllowlist: entries }, 'Allowed addresses saved')) {
            setDraft(entries.join('\n'));
        }
    }, [draft, apply]);

    return (
        <Card padding="sm">
            <Stack gap="md">
                <div>
                    <h3 className={styles.card_title}>Protections for {group.name}</h3>
                    <p className={styles.intro}>
                        These apply to the tools this group grants. When a member reaches the same tool through two groups,
                        each group&apos;s address list is checked on its own, and scrubbing applies if either group asks for it.
                        {policy.updatedAt && <> Last changed <ClientTime date={policy.updatedAt} format="datetime" />.</>}
                    </p>
                </div>

                <PolicyToggle
                    label="Serve this group's tools"
                    description="Switch off to stop serving every tool this group grants, at once, without losing its grants or settings."
                    on={policy.enabled}
                    disabled={working}
                    onChange={confirmEnabled}
                />

                <Stack gap="sm">
                    <div className={styles.policy_text}>
                        <div className={styles.policy_label}>Call limits</div>
                        <div className={styles.tool_meta}>
                            {group.isAnonymous
                                ? 'Calls charged to Anonymous. A caller is one network range (a /24 for IPv4, a /64 for IPv6). Every limit must be set.'
                                : 'Calls charged to this group. A member reaching a tool through several groups is charged to the one with the most generous limits. Leave a box empty for no limit of that kind.'}
                        </div>
                    </div>
                    <Grid columns={3} gap="sm">
                        {LIMIT_FIELDS.map(field => (
                            <Field key={field.key} label={field.label} hint={field.hint}>
                                <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={1}
                                    value={limitDraft[field.key]}
                                    placeholder={group.isAnonymous ? undefined : 'No limit'}
                                    invalid={limitError.length > 0}
                                    onChange={
                                        event => setLimitDraft(current => ({ ...current, [field.key]: event.target.value }))
                                    }
                                />
                            </Field>
                        ))}
                    </Grid>
                    {limitError && <div className="alert" role="alert">{limitError}</div>}
                    <div>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={
                                () => { void saveLimits(); }
                            }
                            disabled={!limitsDirty}
                            loading={working && limitsDirty}
                        >
                            Save limits
                        </Button>
                    </div>
                </Stack>

                <PolicyToggle
                    label="Scrub secrets from results"
                    description="Replace this deployment's own secrets (admin token, auth secrets, API keys, database URLs) and common credential patterns in every result before it leaves TronRelic."
                    on={policy.scrubSecrets}
                    disabled={working}
                    onChange={
                        next => { void apply({ scrubSecrets: next }, next ? 'Secret scrubbing on' : 'Secret scrubbing off'); }
                    }
                />

                <Stack gap="sm">
                    <PolicyToggle
                        label="Restrict by IP address"
                        description="Serve this group's tools only to requests from the addresses below. A stolen token used anywhere else reaches none of them."
                        on={policy.ipAllowlistEnabled}
                        disabled={working || (!policy.ipAllowlistEnabled && policy.ipAllowlist.length === 0)}
                        onChange={
                            next => { void apply({ ipAllowlistEnabled: next }, next ? 'IP allowlist on' : 'IP allowlist off'); }
                        }
                    />
                    <Field
                        label="Allowed addresses"
                        hint={policy.ipAllowlist.length === 0
                            ? 'One address or CIDR range per line, such as 203.0.113.7 or 2001:db8::/32. Save at least one before turning the allowlist on.'
                            : 'One address or CIDR range per line, such as 203.0.113.7 or 2001:db8::/32.'}
                        error={listError}
                        className={styles.address_field}
                    >
                        <Textarea
                            rows={4}
                            value={draft}
                            onChange={
                                event => setDraft(event.target.value)
                            }
                            invalid={listError.length > 0}
                            spellCheck={false}
                            className={styles.address_list}
                        />
                    </Field>
                    <div>
                        <Button
                            size="sm"
                            variant="secondary"
                            onClick={
                                () => { void saveList(); }
                            }
                            disabled={!draftDirty}
                            loading={working && draftDirty}
                        >
                            Save addresses
                        </Button>
                    </div>
                </Stack>

                <PolicyToggle
                    label="Allow restricted tools"
                    description={group.isGateGroup
                        ? 'Not available for mcp-users, because that group is every MCP user. Allow restricted tools on a narrower group such as admin.'
                        : group.isAnonymous
                            ? 'Not available for Anonymous, because its callers are anyone on the internet.'
                            : 'Let this group be granted tools that fail the MCP safety rules: tools that return secrets, change data, reach outside TronRelic, or spend money.'}
                    on={policy.allowRestrictedTools}
                    disabled={working || group.isGateGroup || group.isAnonymous}
                    onChange={confirmRestricted}
                />
            </Stack>
        </Card>
    );
}
