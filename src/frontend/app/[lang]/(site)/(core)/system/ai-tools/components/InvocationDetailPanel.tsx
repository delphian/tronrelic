'use client';

/**
 * @fileoverview Slide-over body for one audit record, the detail half of the
 * Activity feed. The feed row is for scanning; this panel answers the
 * questions an admin opens a call to settle: did it run, who made it, through
 * which app and group, what was asked, and what came back.
 *
 * Every field carries a short explanation behind an info icon, because the
 * record's vocabulary (charged group, token id, trigger path) is not something
 * an admin can be expected to know. Arguments, the result preview, every id,
 * and the whole record can be copied. The notes under the arguments and the
 * result say exactly what was stored, so a short preview or a `[REDACTED]`
 * value is never mistaken for missing data.
 */

import type { ReactNode } from 'react';
import { ArrowUpRight, Filter, Info } from 'lucide-react';
import type { IToolInvocationRecord, ToolInvocationStatus, ToolLimitKind } from '@/types';
import { Badge } from '../../../../../../../components/ui/Badge';
import { Button } from '../../../../../../../components/ui/Button';
import { ClientTime } from '../../../../../../../components/ui/ClientTime';
import { CopyButton } from '../../../../../../../components/ui/CopyButton';
import { Tooltip } from '../../../../../../../components/ui/Tooltip';
import { CapabilityBadges } from './CapabilityBadges';
import { describeCaller } from './describeCaller';
import type { IInvocationFilter } from './IInvocationFilter';
import { invocationStatusText } from './invocationStatusText';
import styles from '../page.module.scss';

/** Characters of a result the audit record keeps, matching the governor's cap. */
const RESULT_PREVIEW_CHARS = 500;

/** The marker records written before arguments were kept in full used for every value of a `secret` tool. */
const LEGACY_REDACTION_MARKER = '[redacted]';

/** Which limit refused a call, in words. */
const LIMIT_TEXT: Readonly<Record<ToolLimitKind, string>> = {
    'caller-minute': "the caller's per-minute limit",
    'caller-tool-minute': "the caller's per-minute limit for this tool",
    'caller-day': "the caller's 24-hour limit",
    'pool-day': "the group's shared 24-hour pool",
    'tool-minute': "this tool's per-minute limit, shared by every caller",
    'global-minute': 'the per-minute limit across all tools',
    cost: "this tool's daily cost ceiling"
};

/** Which MCP address a call arrived at, in words, keyed by the stored endpoint code. */
const ENDPOINT_TEXT: Readonly<Record<string, string>> = {
    oauth: '/mcp, the main address',
    public: '/mcp/public, the anonymous-only address'
};

/**
 * Map an invocation status to a badge tone. Exported so the Activity feed row and
 * this panel colour a status identically.
 *
 * @param status - The terminal invocation status.
 * @returns The badge tone for that status.
 */
export function statusTone(status: ToolInvocationStatus): 'success' | 'warning' | 'danger' | 'info' {
    switch (status) {
        case 'ok': return 'success';
        case 'denied': return 'warning';
        case 'pending-approval': return 'info';
        default: return 'danger';
    }
}

/**
 * Props for {@link InvocationDetailPanel}.
 */
interface IInvocationDetailPanelProps {
    /** The audit record to expand. */
    record: IToolInvocationRecord;

    /**
     * Email addresses keyed by user id, from the activity endpoint, so the
     * caller is named rather than shown as an id. Optional because the Query
     * tab's per-conversation feed does not always carry them.
     */
    userLabels?: Readonly<Record<string, string>>;

    /**
     * Applies a filter to the feed the panel was opened from, such as every
     * call by this caller. The shortcuts are hidden when it is absent, because
     * not every host has filters to apply.
     */
    onFilter?: (filter: IInvocationFilter) => void;
}

/**
 * Props for {@link RelatedLink}.
 */
interface IRelatedLinkProps {
    /** Where the link goes. */
    href: string;

    /** The link text, naming the destination. */
    children: ReactNode;
}

/**
 * A link from a value to the admin page that manages it, such as from a user
 * id to that account, drawn small so it reads as a way onward rather than as
 * the value itself.
 *
 * @param props - {@link IRelatedLinkProps}.
 * @returns The link.
 */
function RelatedLink({ href, children }: IRelatedLinkProps) {
    return (
        <a className={styles.related_link} href={href}>
            {children}
            <ArrowUpRight size={14} aria-hidden />
        </a>
    );
}

/**
 * The link to an account on /system/users, which opens its detail panel.
 *
 * @param userId - The Better Auth user id.
 * @returns The page address.
 */
function accountHref(userId: string): string {
    return `/system/users?tab=users&user=${encodeURIComponent(userId)}`;
}

/**
 * Props for {@link DetailField}.
 */
interface IDetailFieldProps {
    /** The field's name. */
    label: string;

    /** What the field means, shown behind an info icon beside the name. */
    help: string;

    /** The value to show. */
    children: ReactNode;

    /** Plain text to copy, when the value is worth copying (an id, an address). */
    copyValue?: string;
}

/**
 * One labelled value in a detail section, with its explanation behind an info
 * icon so the meaning is one hover away without crowding the panel.
 *
 * @param props - {@link IDetailFieldProps}.
 * @returns A term and its description, for use inside a `<dl>`.
 */
function DetailField({ label, help, children, copyValue }: IDetailFieldProps) {
    return (
        <>
            <dt className={styles.kv_label}>
                <span className={styles.kv_label_text}>
                    {label}
                    {/* The icon carries the explanation as its accessible name,
                        because the shared Tooltip opens on hover and tap only,
                        so a screen reader would otherwise never reach it. */}
                    <Tooltip content={help}>
                        <Info size={14} role="img" aria-label={help} className={styles.kv_help_icon} />
                    </Tooltip>
                </span>
            </dt>
            <dd className={styles.kv_value}>
                <span className={styles.kv_value_row}>
                    <span>{children}</span>
                    {copyValue && <CopyButton value={copyValue} size="xs" aria-label={`Copy ${label}`} />}
                </span>
            </dd>
        </>
    );
}

/**
 * Props for {@link DetailSection}.
 */
interface IDetailSectionProps {
    /** The section heading. */
    title: string;

    /** An action shown at the end of the heading row, such as a copy button. */
    action?: ReactNode;

    /** The section body. */
    children: ReactNode;
}

/**
 * A titled block of the panel, with room for one action beside the title.
 *
 * @param props - {@link IDetailSectionProps}.
 * @returns The section.
 */
function DetailSection({ title, action, children }: IDetailSectionProps) {
    return (
        <section className={styles.detail_section}>
            <div className={styles.detail_section_header}>
                <h4 className={styles.detail_section_title}>{title}</h4>
                {action}
            </div>
            {children}
        </section>
    );
}

/**
 * Say in one sentence what happened to the call, naming the limit or reason
 * that refused it when there was one, so the admin does not have to read the
 * status code and the error separately and put them together.
 *
 * @param record - The audit record.
 * @returns The sentence.
 */
function outcomeSentence(record: IToolInvocationRecord): string {
    let sentence = invocationStatusText[record.status].description;
    if (record.status === 'denied' && record.limitHit) {
        sentence = `Refused by ${LIMIT_TEXT[record.limitHit]}. The tool did not run.`;
    } else if (record.status === 'denied' && record.error) {
        sentence = `Refused before the tool ran: ${record.error}`;
    } else if (record.status === 'error' && record.error) {
        sentence = `The tool started running and then failed: ${record.error}`;
    }
    return sentence;
}

/**
 * Whether the arguments were saved under the old rule that blanked every value
 * of a `secret` tool, so the panel can say they are unrecoverable rather than
 * leave the admin thinking the caller sent the word "redacted".
 *
 * @param record - The audit record.
 * @returns True for a record written before arguments were kept in full.
 */
function argumentsBlankedByOldRule(record: IToolInvocationRecord): boolean {
    const values = Object.values(record.input ?? {});
    return record.capability?.sensitivity === 'secret' && values.length > 0 && values.every(value => value === LEGACY_REDACTION_MARKER);
}

/**
 * Show the result preview as indented JSON when it is a complete JSON value,
 * which it is whenever the result was short enough not to be cut. A cut
 * preview is not valid JSON, so it is shown exactly as stored.
 *
 * @param digest - The stored preview.
 * @returns The text to display.
 */
function formatResult(digest: string): string {
    let text = digest;
    try {
        text = JSON.stringify(JSON.parse(digest), null, 2);
    } catch {
        // A cut preview, or a plain-text result; show it as stored.
    }
    return text;
}

/**
 * Explain how much of the result the preview holds.
 *
 * @param record - The audit record.
 * @returns The sentence, or null when there is no result.
 */
function resultCoverage(record: IToolInvocationRecord): string | null {
    let note: string | null = null;
    const digest = record.resultDigest;
    if (digest !== undefined && record.resultChars !== undefined && record.resultChars > RESULT_PREVIEW_CHARS) {
        note = `Showing the first ${RESULT_PREVIEW_CHARS.toLocaleString('en-US')} of ${record.resultChars.toLocaleString('en-US')} characters. Only this preview is saved, so the rest of the result cannot be shown here.`;
    } else if (digest !== undefined && record.resultChars !== undefined) {
        note = `The whole result, ${record.resultChars.toLocaleString('en-US')} characters.`;
    } else if (digest !== undefined && digest.endsWith('…')) {
        note = `Showing the first ${RESULT_PREVIEW_CHARS.toLocaleString('en-US')} characters. Only this preview is saved, so the rest of the result cannot be shown here.`;
    }
    return note;
}

/**
 * The detail panel for one invocation record, rendered inside the SlideOver body.
 *
 * @param props - {@link IInvocationDetailPanelProps}.
 * @returns The record detail body.
 */
export function InvocationDetailPanel({ record, userLabels = {}, onFilter }: IInvocationDetailPanelProps) {
    const caller = describeCaller(record, userLabels);
    const origin = record.origin;
    // The feed can filter by an MCP caller's principal only, because that is
    // the field it searches; admin and scheduled calls carry no origin.
    const filterPrincipalId = origin?.principalId;
    // An id has an account to open only when the activity endpoint found one
    // for it; anonymous network hashes and the service token never do.
    const callerAccountId = caller.id && userLabels[caller.id] ? caller.id : null;
    const toolHref = record.triggerPath === 'mcp' ? '/system/mcp?tab=tools' : '/system/ai-tools?tab=registry';
    const endUserLabel = record.endUserId ? userLabels[record.endUserId] ?? record.endUserId : null;
    const showEndUser = record.endUserId !== undefined && record.endUserId !== caller.id;
    const argumentsText = JSON.stringify(record.input ?? {}, null, 2);
    const hasArguments = Object.keys(record.input ?? {}).length > 0;
    const blankedByOldRule = argumentsBlankedByOldRule(record);
    const coverage = resultCoverage(record);
    const resultText = record.resultDigest !== undefined ? formatResult(record.resultDigest) : null;

    return (
        <div className={styles.detail}>
            <div className={styles.detail_meta}>
                <div className={styles.detail_meta_row}>
                    <Badge tone={statusTone(record.status)}>{invocationStatusText[record.status].label}</Badge>
                    <CopyButton value={JSON.stringify(record, null, 2)} label="Copy record" size="xs" aria-label="Copy the whole record as JSON" />
                </div>
                <p className={styles.detail_outcome}>{outcomeSentence(record)}</p>
                {onFilter && (
                    <div className={styles.detail_actions}>
                        {filterPrincipalId && (
                            <Button
                                size="xs"
                                variant="secondary"
                                icon={<Filter size={14} aria-hidden />}
                                onClick={() => onFilter({ principalId: filterPrincipalId, principalLabel: caller.primary })}
                            >
                                Every call by this caller
                            </Button>
                        )}
                        <Button
                            size="xs"
                            variant="secondary"
                            icon={<Filter size={14} aria-hidden />}
                            onClick={() => onFilter({ toolName: record.toolName })}
                        >
                            Every call to this tool
                        </Button>
                    </div>
                )}
            </div>

            <DetailSection title="Who made the call">
                <dl className={styles.kv}>
                    <DetailField
                        label="Caller"
                        help="The person or network the call is counted against. Signed-in people are named by their email address. An anonymous MCP caller has no account, so it is identified by a salted hash of its network range (a /24 for IPv4, a /64 for IPv6), which cannot be turned back into an address."
                        copyValue={caller.id ?? undefined}
                    >
                        {caller.primary}
                        <span className={styles.kv_value_note}>{caller.kind}{caller.id && caller.id !== caller.primary ? ` · ${caller.id}` : ''}</span>
                        {callerAccountId && <RelatedLink href={accountHref(callerAccountId)}>Open account</RelatedLink>}
                    </DetailField>
                    {showEndUser && endUserLabel && (
                        <DetailField
                            label="On behalf of"
                            help="The account the tool ran for. A tool that reads someone's own data is limited to this account's data. It differs from the caller when an admin or a scheduled prompt runs a tool for another person."
                            copyValue={record.endUserId}
                        >
                            {endUserLabel}
                            {record.endUserId && userLabels[record.endUserId] && <RelatedLink href={accountHref(record.endUserId)}>Open account</RelatedLink>}
                        </DetailField>
                    )}
                    {origin?.endpoint && (
                        <DetailField
                            label="Arrived at"
                            help="Which MCP address the caller's AI client sent the call to. Anonymous callers and signed-in members share /mcp; /mcp/public is an older address that only serves anonymous callers."
                        >
                            {ENDPOINT_TEXT[origin.endpoint] ?? origin.endpoint}
                        </DetailField>
                    )}
                    {origin?.chargedGroupId && (
                        <DetailField
                            label="Charged to group"
                            help="The user group whose call limits applied to this call. A member who reaches the tool through several groups is charged to the one with the most generous limits. Change a group's limits on the Tools tab of /system/mcp."
                        >
                            {origin.chargedGroupId}
                            <RelatedLink href={`/system/mcp?tab=tools&group=${encodeURIComponent(origin.chargedGroupId)}`}>Group limits and grants</RelatedLink>
                        </DetailField>
                    )}
                    {origin?.clientName && (
                        <DetailField
                            label="Client"
                            help="The name and version the caller's AI client reported about itself, such as claude-ai 0.1.0. The client chooses this text, so treat it as a label, not as proof of who connected."
                        >
                            {origin.clientName}
                        </DetailField>
                    )}
                    {origin?.clientId && (
                        <DetailField
                            label="Connected app"
                            help="The app the member approved on TronRelic's sign-in page, identified by the address of the document the app publishes about itself. Revoke it on the Connected apps tab of /system/mcp."
                            copyValue={origin.clientId}
                        >
                            {origin.clientId}
                            <RelatedLink href="/system/mcp?tab=apps">Connected apps</RelatedLink>
                        </DetailField>
                    )}
                    {origin?.credentialId && (
                        <DetailField
                            label="Token id"
                            help="The id of the access token the call carried, never the token itself. Every call made with the same token shares this id, so it ties calls to one sign-in."
                            copyValue={origin.credentialId}
                        >
                            <span className={styles.mono}>{origin.credentialId}</span>
                        </DetailField>
                    )}
                    {origin?.ip && (
                        <DetailField
                            label="Network address"
                            help="The address the request came from, as seen through Cloudflare and Nginx. For claude.ai this is one of Anthropic's servers, not the member's own computer."
                            copyValue={origin.ip}
                        >
                            <span className={styles.mono}>{origin.ip}</span>
                        </DetailField>
                    )}
                </dl>
            </DetailSection>

            <DetailSection title="When and how">
                <dl className={styles.kv}>
                    <DetailField label="Time" help="When the call finished, in your own time zone.">
                        <ClientTime date={record.createdAt} format="datetime" />
                        <span className={styles.kv_value_note}><ClientTime date={record.createdAt} format="relative" /></span>
                    </DetailField>
                    <DetailField label="Duration" help="How long the tool itself ran. A refused call never ran, so it shows 0 ms.">
                        {record.durationMs.toLocaleString('en-US')} ms
                    </DetailField>
                    {record.costUsd !== undefined && (
                        <DetailField label="Cost" help="What the call cost in US dollars, for tools that spend money, such as image generation.">
                            ≈ ${record.costUsd.toFixed(4)}
                        </DetailField>
                    )}
                    <DetailField
                        label="Trigger"
                        help="What started the call. interactive is an admin on the Query tab, scheduled is a saved prompt on a timer, programmatic is code calling the AI, and mcp is someone's own AI client connected to TronRelic."
                    >
                        {record.triggerPath}
                    </DetailField>
                    <DetailField
                        label="Tool"
                        help="The tool that was called, and the TronRelic module or plugin that registered it."
                        copyValue={record.toolName}
                    >
                        {record.toolName}
                        <span className={styles.kv_value_note}>Registered by {record.providerId}</span>
                        <RelatedLink href={toolHref}>{record.triggerPath === 'mcp' ? 'MCP grants' : 'Tool registry'}</RelatedLink>
                    </DetailField>
                    {record.aiProviderId !== record.triggerPath && (
                        <DetailField label="AI provider" help="The AI provider plugin that ran the query which called the tool, such as ai-assistant for Anthropic.">
                            {record.aiProviderId}
                        </DetailField>
                    )}
                </dl>
            </DetailSection>

            <DetailSection title="What the tool is classed as">
                <CapabilityBadges capability={record.capability} />
                <p className={styles.detail_note}>
                    The tool&apos;s declared class when the call was made. Hover a badge to see what it means.
                </p>
            </DetailSection>

            <DetailSection
                title="Arguments"
                action={hasArguments && !blankedByOldRule ? <CopyButton value={argumentsText} label="Copy" size="xs" aria-label="Copy the arguments as JSON" /> : undefined}
            >
                {hasArguments ? <pre className={styles.args_block}>{argumentsText}</pre> : <p className={styles.detail_note}>The call had no arguments.</p>}
                {blankedByOldRule ? (
                    <p className={styles.detail_note}>
                        This call was recorded before arguments were kept in full. The tool is classed secret, so every value was
                        replaced when the record was saved, and the original values cannot be recovered.
                    </p>
                ) : hasArguments && (
                    <p className={styles.detail_note}>
                        As the tool received them. A value that looks like a credential, such as an API key or a password, is saved
                        as [REDACTED].
                    </p>
                )}
            </DetailSection>

            <DetailSection
                title="Result"
                action={record.resultDigest !== undefined ? <CopyButton value={record.resultDigest} label="Copy" size="xs" aria-label="Copy the result preview" /> : undefined}
            >
                {resultText !== null ? (
                    <>
                        <pre className={styles.args_block}>{resultText}</pre>
                        {coverage && <p className={styles.detail_note}>{coverage}</p>}
                        <p className={styles.detail_note}>
                            The result as the tool returned it, before any wrapping for the AI model. A value that looks like a
                            credential is saved as [REDACTED].
                            {record.capability?.surfacesUntrustedContent && ' The caller received it marked as untrusted content, which tells its model to treat it as data rather than instructions.'}
                        </p>
                        {record.conversationId && (
                            <p className={styles.detail_note}>
                                The full result is in the conversation&apos;s transcript:{' '}
                                <a className="link" href={`/system/ai-tools?tab=query&conversation=${encodeURIComponent(record.conversationId)}`}>open the conversation</a>.
                            </p>
                        )}
                    </>
                ) : (
                    <p className={styles.detail_note}>
                        {record.status === 'ok' ? 'The tool returned nothing.' : 'No result, because the tool did not finish.'}
                    </p>
                )}
            </DetailSection>

            {(record.error || record.errorRaw) && (
                <DetailSection title="Error">
                    <div className={styles.detail_error}>
                        {record.error && <span><strong>Reason given to the caller: </strong>{record.error}</span>}
                        {record.errorRaw && <span className={styles.mono}><strong>Full upstream error, admins only: </strong>{record.errorRaw}</span>}
                    </div>
                </DetailSection>
            )}

            {record.screen && (
                <DetailSection title="Untrusted-content screen">
                    <dl className={styles.kv}>
                        <DetailField
                            label="Verdict"
                            help="Whether a separate, cheap AI check judged the result to contain instructions planted to manipulate the model. A withheld result never reached the model."
                        >
                            <Badge tone={record.screen.flagged ? 'danger' : 'success'}>
                                {record.screen.flagged ? 'Withheld' : 'Passed'}
                            </Badge>
                        </DetailField>
                        {record.screen.reason && (
                            <DetailField label="Reason" help="The screening check's explanation, or why the check could not run.">
                                {record.screen.reason}
                            </DetailField>
                        )}
                    </dl>
                </DetailSection>
            )}

            <DetailSection title="Reference ids">
                <dl className={styles.kv}>
                    <DetailField label="Record id" help="This audit record's own id. AI tools and logs refer to a call by it." copyValue={record.id}>
                        <span className={styles.mono}>{record.id}</span>
                    </DetailField>
                    {record.toolUseId && (
                        <DetailField label="Tool call id" help="The id the AI model gave this one tool call. It matches the call in the conversation's transcript." copyValue={record.toolUseId}>
                            <span className={styles.mono}>{record.toolUseId}</span>
                        </DetailField>
                    )}
                    {record.queryId && (
                        <DetailField label="Query id" help="The query this call was part of. Every tool call from one question shares it." copyValue={record.queryId}>
                            <span className={styles.mono}>{record.queryId}</span>
                        </DetailField>
                    )}
                    {record.conversationId && (
                        <DetailField label="Conversation id" help="The conversation on the Query tab this call belongs to." copyValue={record.conversationId}>
                            <span className={styles.mono}>{record.conversationId}</span>
                        </DetailField>
                    )}
                </dl>
            </DetailSection>
        </div>
    );
}
