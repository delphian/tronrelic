'use client';

/**
 * @fileoverview Query tab — the core-owned, provider-neutral AI chat surface on
 * the /system/ai-tools dashboard. A multi-turn conversation streamed over the
 * shared core socket: each send mints a client-side `queryId`, POSTs the prompt
 * with the prior turns as history, and appends the streamed deltas to a pending
 * assistant turn by filtering the GLOBAL `ai-tools:query-stream` event on that
 * id. Like the sibling tabs this is an interactive admin client surface, not an
 * SSR-first public component — loading states are appropriate for its secondary
 * data and user-triggered sends.
 *
 * The surface is laid out the way current chat interfaces are, because the
 * previous shape — a short scroll box inside a scrolling page, with the history
 * as a separate view that replaced the chat — was reported as hard to use:
 *
 * - The chat pane fills the viewport below the page chrome (`useViewportFill`
 *   measures the offset), so the transcript is the one scrolling region and
 *   the composer stays pinned to the bottom of the screen.
 * - The transcript follows a streaming answer only while the reader is at the
 *   live edge, releases the moment they scroll up, and offers a "Latest"
 *   button back (`useTranscriptScroll`). A send anchors the new message at the
 *   top of the pane so the answer streams into empty space beneath it.
 * - Past conversations sit in a collapsible rail beside the chat and open in
 *   place; the tab stays mounted across the dashboard's other tabs and keeps
 *   the open conversation in the URL, so neither a tab switch nor a refresh
 *   loses it.
 * - Enter sends and Shift+Enter inserts a newline; the composer grows with its
 *   text; per-message actions appear on hover.
 *
 * A per-run tool allowlist (a dropdown in the composer) narrows which tools the
 * next send may call. It defaults to no tools — least privilege — so a manual
 * query is inert until the operator deliberately grants a tool for that run.
 * Registry tools are named plainly; provider-hosted tools (the AI vendor's own
 * web search and fetch) are named behind a `hosted:` prefix and refetched
 * whenever the composer's provider and model pin changes.
 *
 * This card is also the **saved-prompt editor**. Picking a prompt from the
 * header selector starts a fresh chat and loads that prompt's text into the
 * composer, its model pin into the picker, its allowlist into the tools
 * dropdown, and its triggers into a panel above the composer — so one Save
 * writes the whole document. The editing mode is framed by a strip directly
 * above the composer, and three consequences follow from the composer doubling
 * as the body field:
 *
 * - **Send does not clear the composer while a prompt is loaded.** The text is
 *   the prompt body; clearing it would empty what Save writes.
 * - **The tool selection is sticky while a prompt is loaded**, because it *is*
 *   that prompt's allowlist rather than a one-shot grant.
 * - **The allowlist keeps its three-state contract.** `undefined` means "every
 *   tool that is switched on, kept current" and is only pre-filled for display;
 *   `toolsTouched` records whether the operator really engaged the picker, so an
 *   untouched save writes `null` instead of freezing today's set.
 *
 * The model picker spans every registered provider so a prompt can pin a model on
 * a non-active one. An interactive send always runs on the *active* provider, so a
 * pin belonging to a different provider is deliberately not forwarded as the
 * per-send model override — it still saves onto the prompt for its autonomous runs.
 */

import { useEffect, useState, useRef, useCallback, useMemo, type CSSProperties } from 'react';
import { ArrowUp, ArrowDown, Bot, AlertCircle, Square, X, Plus, PanelLeft, Trash2, AlertTriangle } from 'lucide-react';
import type { IAiConversationMessage, IAiQueryRecord, IAiStreamChunk, IAiToolInfo, IAiTranscriptSegment, ISavedPrompt, IToolInvocationRecord, ITrifectaStatus } from '@/types';
import { hostedToolEntry } from '@/types';
import { Card } from '../../../../../components/ui/Card';
import { Button } from '../../../../../components/ui/Button';
import { Select } from '../../../../../components/ui/Select';
import { Textarea } from '../../../../../components/ui/Textarea';
import { IconButton } from '../../../../../components/ui/IconButton';
import { getSocket } from '../../../../../lib/socketClient';
import { SlideOver } from '../../../../../components/ui/SlideOver';
import {
    submitQuery,
    cancelQuery,
    getQueryHistory,
    getConversation,
    getQueryProviders,
    listActivity,
    listTools,
    listHostedTools,
    getTrifectaPreview,
    runSavedPromptNow,
    listSavedPrompts,
    saveSavedPrompt,
    deleteSavedPrompt,
    listPromptTriggerHooks,
    useTranscriptScroll,
    useViewportFill,
    type IAiProviderModels,
    type IBindableHookInfo,
    type IStreamAck
} from '../../../../../modules/ai-tools';
import { useToast } from '../../../../../components/ui/ToastProvider';
import { useModal } from '../../../../../components/ui/ModalProvider';
import { InvocationDetailPanel } from '../components/InvocationDetailPanel';
import { InvocationTable } from '../components/InvocationTable';
import { ToolAllowlistDropdown } from '../components/ToolAllowlistDropdown';
import { SavedPromptSelector } from '../components/SavedPromptSelector';
import { PromptEditorBar } from './PromptEditorBar';
import { PromptTriggersEditor } from './PromptTriggersEditor';
import { ConversationRail } from './ConversationRail';
import { TranscriptTurn } from './TranscriptTurn';
import { formatUsd } from './formatUsd';
import { writeAiToolsSearchParam } from './aiToolsUrl';
import type { IChatTurn } from './IChatTurn';
import type { IConversationGroup } from './IConversationGroup';
import {
    type ITriggerDraft,
    toTriggerDrafts,
    toTriggerRequests,
    hasInvalidTriggerDraft,
    encodeModelPin,
    decodeModelPin,
    resolveToolAllowlistForSave,
    isPromptDirty
} from './savedPromptDraft';
import promptStyles from './PromptEditor.module.scss';
import styles from './QueryTab.module.scss';

/** WebSocket event carrying a streamed AI response chunk to the dashboard. */
const QUERY_STREAM_EVENT = 'ai-tools:query-stream';

/** Records fetched per page of the conversation rail. */
const HISTORY_PAGE_SIZE = 100;

/**
 * How often (ms) the saved-prompt list is refetched while at least one trigger
 * is enabled, so a `lastRunAt` written by the backend scheduler appears without
 * a page refresh. There is no WebSocket signal for an autonomous run, so this
 * poll is the refresh channel; the backend job ticks every two minutes, so a 30s
 * cadence surfaces a new run quickly while staying light. Gated on there being
 * an active trigger, so an all-manual prompt library never polls.
 */
const SAVED_PROMPT_REFRESH_MS = 30_000;

/**
 * How often (ms) to look for the result of a run-now the operator chose to
 * open before it finished. The run records one history row when it settles
 * and emits no signal, so polling the conversation is the only way to notice.
 */
const PENDING_RUN_POLL_MS = 5_000;

/** How long (ms) to keep polling for a run-now result before giving up. */
const PENDING_RUN_POLL_LIMIT_MS = 15 * 60_000;

/** Tallest the composer grows on its own before it scrolls instead. */
const COMPOSER_MAX_ROWS = 8;

/**
 * Generate an RFC-4122 v4 UUID, preferring the native crypto implementation and
 * falling back to a Math.random() generator. `crypto.randomUUID` is only defined
 * in secure contexts (HTTPS or localhost), so a plain-HTTP staging deployment
 * would otherwise throw when minting turn, conversation, and query ids. Called
 * only from event handlers, never during render, so the non-deterministic
 * fallback cannot cause a hydration mismatch.
 *
 * @returns A v4 UUID string.
 */
function generateUUID(): string {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
    });
}

/**
 * Fold a streamed text delta into a turn's live transcript, extending the run of
 * prose already in progress or starting a new one after a tool call.
 *
 * A streaming turn builds the same segment structure the settled transcript
 * uses, so the answer and the tool activity render in one ordered list rather
 * than prose in one place and tool cards appended somewhere after it. Text
 * merges into a trailing text segment because the provider streams prose token
 * by token — a segment per delta would fragment one paragraph into dozens of
 * separately-rendered Markdown blocks.
 *
 * Returns a new array rather than mutating, since the caller stores the result
 * in React state where an in-place edit would not re-render.
 *
 * @param segments - The turn's live segments so far, if any.
 * @param text - The delta just received.
 * @returns The segments with the delta folded in.
 */
function appendLiveText(segments: IAiTranscriptSegment[] | undefined, text: string): IAiTranscriptSegment[] {
    const next = [...(segments ?? [])];
    const last = next[next.length - 1];
    if (last && last.type === 'text') {
        next[next.length - 1] = { type: 'text', text: last.text + text };
    } else {
        next.push({ type: 'text', text });
    }
    return next;
}

/**
 * Key tool-invocation audit records by their provider-neutral `toolUseId` so a
 * transcript's tool_use segment resolves to its exact record in O(1). Records
 * without a `toolUseId` (legacy rows, or a provider that predates the field)
 * are skipped; their calls simply render without a detail link.
 *
 * @param records - Audit records for one conversation, in any order.
 * @returns The records that carry a `toolUseId`, keyed by it.
 */
function indexByToolUseId(records: IToolInvocationRecord[]): Map<string, IToolInvocationRecord> {
    const map = new Map<string, IToolInvocationRecord>();
    for (const record of records) {
        if (record.toolUseId) {
            map.set(record.toolUseId, record);
        }
    }
    return map;
}

/**
 * Select the audit records a transcript has no route to. A record is reachable
 * from a transcript only when its `toolUseId` matches a `tool_use` segment, so a
 * record written without one — a legacy row, or a provider that never emitted the
 * pairing id — carries no "Details" link and would be unreachable otherwise.
 * Listing exactly those leftovers keeps the transcript the primary account of
 * what ran while making sure no invocation goes missing.
 *
 * @param turns - The turns rendered above the leftovers.
 * @param records - The conversation's tool-invocation audit records.
 * @returns The records the transcript cannot reach, in their original order.
 */
function selectUnlinkedRecords(turns: IChatTurn[], records: IToolInvocationRecord[]): IToolInvocationRecord[] {
    const linked = new Set<string>();
    for (const turn of turns) {
        for (const segment of turn.segments ?? []) {
            if (segment.type === 'tool_use' && segment.id) {
                linked.add(segment.id);
            }
        }
    }
    return records.filter(record => !record.toolUseId || !linked.has(record.toolUseId));
}

/**
 * Rebuild a stored conversation into the alternating user/assistant turns the
 * transcript renders.
 *
 * A failed turn carries no answer text and no transcript, so without the
 * fallback below it would render as a blank assistant bubble that looks like the
 * model simply said nothing. Surfacing `errorMessage` — or a plain note when the
 * record has neither text, structure, nor a reason — is what makes a failure
 * legible at all. The same field also carries the reason an *incomplete* run
 * stopped short, so a truncated or refused turn states why beside whatever
 * partial answer it did manage to produce.
 *
 * @param records - One conversation's turns, oldest first.
 * @returns Chat turns ready to render, two per stored record.
 */
function recordsToChatTurns(records: IAiQueryRecord[]): IChatTurn[] {
    const rebuilt: IChatTurn[] = [];
    for (const record of records) {
        rebuilt.push({ id: generateUUID(), role: 'user', content: record.prompt });
        // A turn has a body when it left answer text OR a structured transcript
        // (a tool-only round can finish with no final text yet still have plenty
        // to show). Only a truly empty, non-failed record falls back to the note.
        const hasBody = !!record.responseText || (record.transcript?.length ?? 0) > 0;
        rebuilt.push({
            id: generateUUID(),
            role: 'assistant',
            content: record.responseText ?? '',
            model: record.model,
            usage: record.usage,
            costUsd: record.costUsd ?? null,
            error: record.errorMessage ?? (hasBody ? null : 'No response recorded'),
            ...(record.transcript && record.transcript.length > 0 ? { segments: record.transcript } : {})
        });
    }
    return rebuilt;
}

/**
 * Collapse a newest-first history page into conversation groups, one per run of
 * records sharing a `conversationId`. Records without a conversationId (one-shot
 * turns) are skipped — only multi-turn chats can be reopened. Within the
 * newest-first feed the first record of each group is the latest turn, so its
 * timestamp dates the group.
 *
 * @param records - History records, newest first.
 * @returns Conversation groups in newest-first order.
 */
function groupConversations(records: IAiQueryRecord[]): IConversationGroup[] {
    const order: string[] = [];
    const byId = new Map<string, IConversationGroup>();
    for (const record of records) {
        const id = record.conversationId;
        if (!id) {
            continue;
        }
        // Add this turn's priced cost, treating an unpriced turn as a no-op so
        // a partially-priced conversation still surfaces the sum of what could
        // be priced rather than collapsing to null.
        const turnCost = typeof record.costUsd === 'number' ? record.costUsd : null;
        const existing = byId.get(id);
        if (existing) {
            existing.turns += 1;
            if (turnCost !== null) {
                existing.costUsd = (existing.costUsd ?? 0) + turnCost;
            }
            // Records arrive newest-first, so an earlier record carries the
            // older prompt — keep it as the conversation's opening line.
            existing.firstPrompt = record.prompt;
        } else {
            order.push(id);
            byId.set(id, {
                conversationId: id,
                turns: 1,
                firstPrompt: record.prompt,
                lastAt: record.createdAt,
                mode: record.mode,
                status: record.status,
                outcome: record.outcome,
                errorMessage: record.errorMessage ?? null,
                costUsd: turnCost
            });
        }
    }
    return order.map(id => byId.get(id) as IConversationGroup);
}

/**
 * Whether two string lists hold the same members in the same order. Used to
 * keep a per-turn array's identity stable across renders, which is what lets
 * the memoised turn component skip work when nothing about that turn changed.
 *
 * @param a - The previous list.
 * @param b - The freshly computed list.
 * @returns True when the two are equal element by element.
 */
function sameList(a: readonly string[], b: readonly string[]): boolean {
    return a.length === b.length && a.every((value, index) => value === b[index]);
}

/**
 * Whether two string sets hold the same members. Same purpose as {@link sameList}.
 *
 * @param a - The previous set.
 * @param b - The freshly computed set.
 * @returns True when the two hold exactly the same names.
 */
function sameSet(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
    if (a.size !== b.size) {
        return false;
    }
    for (const value of a) {
        if (!b.has(value)) {
            return false;
        }
    }
    return true;
}

/** Name prefix for prompts saved straight from a chat turn. */
const TURN_PROMPT_NAME_PREFIX = 'Saved Prompt';

/**
 * Neutralise regex metacharacters so a plain string can be embedded in a pattern
 * literally. Needed because the turn-prompt pattern below is built from the
 * display prefix above; if that prefix ever gains a character like `(` or `.`,
 * an unescaped interpolation would compile into a pattern that quietly matches
 * the wrong names — or throws — instead of the literal text an operator sees.
 *
 * @param value - The literal text to embed.
 * @returns The same text with every metacharacter backslash-escaped.
 */
function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Matches an auto-generated turn-saved prompt name so its number can be read
 * back. Derived from `TURN_PROMPT_NAME_PREFIX` rather than repeating it, so the
 * generator and the parser cannot drift apart if the prefix ever changes.
 */
const TURN_PROMPT_NAME_PATTERN = new RegExp(`^${escapeRegex(TURN_PROMPT_NAME_PREFIX)} (\\d+)$`, 'i');

/**
 * Pick the next auto-generated name for a prompt saved from a chat turn. Saving
 * from a turn is a one-click action with nowhere to type a name, so the name has
 * to be derived — and it must not collide, because the backend enforces a
 * case-insensitive unique index and would reject a duplicate with a 409. Counting
 * up from the highest existing `Saved Prompt NN` gives a name that is stable for a
 * given list and never reuses a number still in play, even after earlier ones are
 * deleted.
 *
 * @param existing - The current saved prompts, whose names are scanned for the
 *   auto-generated pattern; names an operator typed are ignored.
 * @returns The next name, zero-padded to two digits (e.g. `Saved Prompt 03`).
 */
function nextTurnPromptName(existing: ISavedPrompt[]): string {
    let highest = 0;
    for (const prompt of existing) {
        const match = TURN_PROMPT_NAME_PATTERN.exec(prompt.name.trim());
        if (!match) {
            continue;
        }
        const value = Number.parseInt(match[1], 10);
        if (Number.isFinite(value) && value > highest) {
            highest = value;
        }
    }
    return `${TURN_PROMPT_NAME_PREFIX} ${String(highest + 1).padStart(2, '0')}`;
}

/** Props for {@link QueryTab}. */
export interface IQueryTabProps {
    /**
     * Whether this tab is the one on screen. The shell keeps the tab mounted
     * behind the others so a conversation survives a tab switch, and this flag
     * tells the layout measurement when the pane has become visible again.
     */
    active: boolean;
    /**
     * Conversation id from the page's `?conversation=` deep link, read SSR-first
     * by the page entry so a refreshed or shared address reopens the thread.
     */
    initialConversationId?: string | null;
}

/**
 * Query tab content. Owns the chat transcript, the streaming lifecycle keyed by
 * a per-send `queryId`, the model picker, the conversation rail, and the
 * saved-prompt editor.
 *
 * @param props - See {@link IQueryTabProps}.
 * @returns The tab.
 */
export function QueryTab({ active, initialConversationId = null }: IQueryTabProps) {
    const { push } = useToast();
    const modal = useModal();
    const [messages, setMessages] = useState<IChatTurn[]>([]);
    const [input, setInput] = useState('');
    const [streaming, setStreaming] = useState(false);
    const [error, setError] = useState<string | null>(null);
    /**
     * Every registered AI provider with its model catalog. Spans providers (not
     * just the active one) because a saved prompt may pin a model on a provider
     * that is not currently the transport — the picker has to be able to offer it.
     */
    const [providers, setProviders] = useState<IAiProviderModels[]>([]);
    /**
     * The composer's model choice, encoded `providerId|model`; `''` = the active
     * provider's default. One control serves two purposes: the override for the
     * next interactive send, and — while a prompt is loaded — that prompt's
     * persisted pin.
     */
    const [modelOverride, setModelOverride] = useState<string>('');
    /** The full tool registry (enabled + disabled), backing the per-run allowlist picker. */
    const [tools, setTools] = useState<IAiToolInfo[]>([]);
    /**
     * Provider-hosted tools (web search / fetch) available to the composer's
     * current provider and model. Refetched whenever that choice changes,
     * because the provider stores these switches per model and a prompt pinned
     * to one model must be offered what that model can actually run.
     */
    const [hostedTools, setHostedTools] = useState<IAiToolInfo[]>([]);
    /**
     * Whether the tool-registry request is still in flight. Distinguishes "no
     * tools granted" from "not known yet": an unrestricted prompt's selection is
     * `[]` until the pre-fill runs, and `[]` is an explicit deny on the wire, so
     * a send during this window would run the test with no tools at all.
     */
    const [toolsLoading, setToolsLoading] = useState(true);
    /**
     * Tool names the next send is allowed to call. Defaults to none — a manual
     * query does nothing dangerous unless the operator grants a tool for that
     * run. Sent verbatim to the governor on every send: `[]` = no tools, a list =
     * that subset (no three-state contract, since a one-shot run persists nothing).
     */
    const [toolSelection, setToolSelection] = useState<string[]>([]);
    /** Whether the composer's Tools dropdown is open; gates the trifecta preview so it runs only when visible. */
    const [toolsOpen, setToolsOpen] = useState(false);
    /** Scoped lethal-trifecta verdict for the current selection, or null before the first preview resolves. */
    const [trifecta, setTrifecta] = useState<ITrifectaStatus | null>(null);
    /** Whether a trifecta preview request is in flight (drives the badge's pending state). */
    const [trifectaLoading, setTrifectaLoading] = useState(false);
    /** Id of the turn or conversation whose copy control was just used. */
    const [copiedId, setCopiedId] = useState<string | null>(null);
    /** The saved-prompt library, backing the header selector and the editor. */
    const [savedPrompts, setSavedPrompts] = useState<ISavedPrompt[]>([]);
    /** Id of the user turn whose "save as prompt" write is in flight, or null when idle. */
    const [savingTurnId, setSavingTurnId] = useState<string | null>(null);

    /*
     * ---- Conversation rail ---------------------------------------------------
     * The history records behind the rail, accumulated a page at a time, and
     * the id of the conversation the transcript shows (mirrored from the ref
     * below so the rail can highlight it).
     */
    /** Whether the rail is shown beside the chat. */
    const [railOpen, setRailOpen] = useState(true);
    /** Every history record loaded so far, newest first. */
    const [historyRecords, setHistoryRecords] = useState<IAiQueryRecord[]>([]);
    /** The server's total record count, so the rail knows whether more pages exist. */
    const [historyTotal, setHistoryTotal] = useState(0);
    const [historyLoading, setHistoryLoading] = useState(true);
    const [historyLoadingMore, setHistoryLoadingMore] = useState(false);
    const [historyError, setHistoryError] = useState<string | null>(null);
    /** The conversation the transcript shows, for the rail's selected row and the URL. */
    const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
    /**
     * Conversation id of a run-now the operator chose to open before it
     * finished. While set, the empty transcript explains that the run is in
     * progress and a poll watches for its history row.
     */
    const [awaitingRunId, setAwaitingRunId] = useState<string | null>(null);

    /*
     * ---- Saved-prompt editor -------------------------------------------------
     * Whether the prompt strip is showing, which stored prompt it edits (null
     * while writing a brand-new one), and the drafts for the fields the composer
     * does not already own. Body, model, and tools live in the composer controls
     * — that is the whole point of retiring the modal — so only the name and the
     * trigger rows need state of their own.
     */
    /** Whether a prompt is being edited; drives the strip and the triggers panel. */
    const [editingPrompt, setEditingPrompt] = useState(false);
    /** Id of the stored prompt under edit, or null for one not yet created. */
    const [loadedPromptId, setLoadedPromptId] = useState<string | null>(null);
    /** The name field's draft value. */
    const [promptName, setPromptName] = useState('');
    /** The trigger rows as edited; saved together with everything else. */
    const [triggerDrafts, setTriggerDrafts] = useState<ITriggerDraft[]>([]);
    /** Whether the triggers panel is revealed above the composer. */
    const [triggersOpen, setTriggersOpen] = useState(false);
    /** Whether the single prompt save is in flight. */
    const [promptSaving, setPromptSaving] = useState(false);
    /**
     * Whether the operator actually engaged the Tools picker while editing this
     * prompt. The pre-fill seeds the selection to the full enabled set for
     * display, which is indistinguishable from a deliberate "select all"; this
     * flag records real intent so an untouched save of an unset prompt writes
     * `null` (all enabled, auto-updating) rather than freezing today's set.
     */
    const [toolsTouched, setToolsTouched] = useState(false);
    /** Declared hook seams a hook trigger may bind to, for the triggers editor. */
    const [bindableHooks, setBindableHooks] = useState<IBindableHookInfo[]>([]);
    /**
     * Tool-invocation audit records for the open conversation, loaded from the
     * Activity feed scoped by conversationId. Backs the transcript's per-call
     * "Details" deep-links — the transcript itself shows what ran, so the chat
     * view carries no summary table over the records it can already reach. The
     * leftovers it cannot reach are listed separately (see {@link unlinkedRecords}).
     */
    const [conversationRecords, setConversationRecords] = useState<IToolInvocationRecord[]>([]);
    /** The audit record whose detail slide-over is open, or null when closed. */
    const [selectedRecord, setSelectedRecord] = useState<IToolInvocationRecord | null>(null);

    /** The queryId whose stream chunks the handler currently accepts. */
    const activeQueryIdRef = useRef<string | null>(null);
    /** Id of the assistant turn currently receiving stream chunks. */
    const streamingTurnIdRef = useRef<string | null>(null);
    /** Stable id shared by every turn of this chat session; minted lazily on first send. */
    const conversationIdRef = useRef<string | null>(null);
    /** The scrolling transcript. */
    const transcriptRef = useRef<HTMLDivElement>(null);
    /** The rail-plus-card row, measured to size the pane to the viewport. */
    const workspaceRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const copyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    /**
     * Id of the user turn the transcript should scroll to the top of the pane
     * once it has rendered. Set by a send and consumed by the follow effect.
     */
    const pendingAnchorTurnIdRef = useRef<string | null>(null);
    /** Whether the `?conversation=` deep link has been applied, so it fires once. */
    const initialOpenedRef = useRef(false);
    /**
     * False once the component unmounts. Stream chunks and the POST response can
     * arrive after the tab switches away mid-stream; guarding state updates on
     * this flag prevents setState-after-unmount work.
     */
    const isMountedRef = useRef(true);
    /**
     * Bumped on every authoritative write to {@link savedPrompts} (a save, a
     * duplicate, a delete). The background refresh poll captures it before its
     * request and discards its own response if the value moved, so a slow poll
     * can never overwrite fresher data it started before.
     */
    const savedPromptsWriteRef = useRef(0);
    /**
     * Previous per-turn tool arrays and called-tool sets, kept so a turn whose
     * tools did not change is handed the same object again. The memoised turn
     * component compares props by identity, and without this every streamed
     * chunk would rebuild every user turn's chips.
     */
    const turnToolsCacheRef = useRef(new Map<string, string[]>());
    const calledToolsCacheRef = useRef(new Map<string, Set<string>>());
    /**
     * The latest per-turn tool map, readable from a callback without listing it
     * as a dependency. The save-as-prompt handler is passed to every user turn,
     * and if its identity followed the map it would change on every streamed
     * chunk and defeat the turn memo.
     */
    const turnToolsByTurnIdRef = useRef(new Map<string, string[]>());

    const { atBottom, followRef, scrollToBottom, anchorToTop, followIfEnabled } = useTranscriptScroll(transcriptRef);
    const paneTop = useViewportFill(workspaceRef, active);

    /**
     * Audit records keyed by their provider-neutral `toolUseId`, so a transcript
     * tool_use segment resolves to its exact invocation record in O(1).
     */
    const toolRecordsById = useMemo(() => indexByToolUseId(conversationRecords), [conversationRecords]);

    /**
     * Allowlist entries for the tools actually invoked in answer to each user
     * turn, keyed by that turn's id. Read from the assistant turns that follow a
     * prompt (up to the next prompt), because the transcript is the only
     * per-turn record of what the model chose to call — the audit feed is
     * conversation-scoped and cannot say which prompt triggered a given call.
     *
     * A provider-hosted call (`segment.server`) is recorded with the `hosted:`
     * prefix rather than skipped. Those tools are grantable per run, so the
     * bookmark this set feeds has to carry them: a turn that answered using web
     * search, saved as a prompt, must produce a prompt that may still search.
     */
    const calledToolsByTurnId = useMemo(() => {
        const cache = calledToolsCacheRef.current;
        const map = new Map<string, Set<string>>();
        messages.forEach((turn, index) => {
            if (turn.role !== 'user') {
                return;
            }
            const called = new Set<string>();
            for (let next = index + 1; next < messages.length && messages[next].role === 'assistant'; next += 1) {
                for (const segment of messages[next].segments ?? []) {
                    if (segment.type === 'tool_use' && segment.name) {
                        called.add(segment.server ? hostedToolEntry(segment.name) : segment.name);
                    }
                }
            }
            const previous = cache.get(turn.id);
            map.set(turn.id, previous && sameSet(previous, called) ? previous : called);
        });
        calledToolsCacheRef.current = map;
        return map;
    }, [messages]);

    /**
     * The tools each user turn is credited with, keyed by turn id: the grant
     * captured at send time unioned with the tools the answer actually called,
     * governed and provider-hosted alike. One source for both the chips a turn
     * renders and the allowlist its bookmark saves, so what an operator sees
     * beside the bookmark is exactly what the bookmark persists.
     *
     * The union is what makes a turn reopened from history saveable at all. The
     * grant is not part of the stored query record, so `turn.tools` is undefined
     * there and the transcript's calls are the only surviving evidence of what
     * that prompt was permitted to do.
     */
    const turnToolsByTurnId = useMemo(() => {
        const cache = turnToolsCacheRef.current;
        const map = new Map<string, string[]>();
        for (const turn of messages) {
            if (turn.role !== 'user') {
                continue;
            }
            const union = new Set([...(turn.tools ?? []), ...(calledToolsByTurnId.get(turn.id) ?? [])]);
            const list = [...union].sort((a, b) => a.localeCompare(b));
            const previous = cache.get(turn.id);
            map.set(turn.id, previous && sameList(previous, list) ? previous : list);
        }
        turnToolsCacheRef.current = map;
        turnToolsByTurnIdRef.current = map;
        return map;
    }, [messages, calledToolsByTurnId]);

    /**
     * Audit records the transcript has no route to. A record is reachable from a
     * transcript only when its `toolUseId` matches a `tool_use` segment, so a
     * record written without one carries no "Details" link and would be
     * unreachable on this view entirely. Listing exactly those leftovers keeps
     * the transcript the primary account of what ran while making sure no
     * invocation goes missing from the chat.
     */
    const unlinkedRecords = useMemo(
        () => selectUnlinkedRecords(messages, conversationRecords),
        [messages, conversationRecords]
    );

    /**
     * The pending grant as chips under the composer, sorted so the row does not
     * reshuffle as options are ticked in the dropdown.
     */
    const grantedTools = useMemo(
        () => [...toolSelection].sort((a, b) => a.localeCompare(b)),
        [toolSelection]
    );

    /** The rail's rows, regrouped whenever a page lands or the list refreshes. */
    const conversations = useMemo(() => groupConversations(historyRecords), [historyRecords]);

    /** Whether the server holds records beyond the loaded pages. */
    const hasMoreHistory = historyRecords.length < historyTotal;

    /**
     * Drop one tool from the pending grant, so the chips are a control and not
     * just a readout — narrowing a selection should not mean reopening the
     * dropdown to hunt for the checkbox.
     *
     * Marks the selection as touched for the same reason the dropdown's onChange
     * does: while a saved prompt is loaded this chip row edits that prompt's
     * allowlist, and a removal here has to count as real intent or the save path
     * would discard it as part of the display-only pre-fill.
     *
     * @param name - The tool name to revoke.
     */
    const handleRevokeTool = useCallback((name: string) => {
        setToolsTouched(true);
        setToolSelection(prev => prev.filter(entry => entry !== name));
    }, []);

    useEffect(() => {
        isMountedRef.current = true;
        return () => {
            isMountedRef.current = false;
            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current);
            }
        };
    }, []);

    // Load every provider's model catalog once. Empty array ⇒ no override choices.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await getQueryProviders();
                if (!cancelled) {
                    setProviders(list);
                }
            } catch {
                /* secondary data — the picker simply offers no choices on failure */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Load the saved-prompt library once, so the header selector is populated
    // before the operator opens it. Secondary data on an admin surface: a quiet
    // failure leaves the selector empty, never a broken chat.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await listSavedPrompts();
                if (!cancelled) {
                    setSavedPrompts(list);
                }
            } catch {
                /* selector renders its empty state */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Load the bindable-hook catalog for the triggers editor's hook picker. A
    // quiet failure leaves the picker empty and "Add hook trigger" disabled.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const hooks = await listPromptTriggerHooks();
                if (!cancelled) {
                    setBindableHooks(hooks);
                }
            } catch {
                /* picker stays empty; hook triggers cannot be added */
            }
        })();
        return () => { cancelled = true; };
    }, []);

    // Load the tool registry once for the per-run allowlist picker. Secondary
    // data on an interactive surface — a quiet failure leaves the picker empty,
    // which only means the run gets no tools (the default), never a broken chat.
    useEffect(() => {
        let cancelled = false;
        void (async () => {
            try {
                const list = await listTools();
                if (!cancelled) {
                    setTools(list);
                }
            } catch {
                /* picker shows no options; the run simply gets no tools */
            } finally {
                if (!cancelled) {
                    setToolsLoading(false);
                }
            }
        })();
        return () => { cancelled = true; };
    }, []);

    /** The stored document behind the editor, or null while creating a new one. */
    const loadedPrompt = useMemo(
        () => savedPrompts.find(prompt => prompt.id === loadedPromptId) ?? null,
        [savedPrompts, loadedPromptId]
    );

    /** The provider an interactive send actually runs on, or null when none is installed. */
    const activeProvider = useMemo(
        () => providers.find(provider => provider.active) ?? null,
        [providers]
    );

    /**
     * The model override forwarded with the next interactive send. An interactive
     * query always executes on the active provider, so a pin belonging to a
     * different provider is deliberately dropped here rather than handed over as
     * a model that provider cannot resolve. The pin itself is untouched and still
     * saves onto the prompt, where its autonomous runs resolve the right transport.
     */
    const sendModel = useMemo(() => {
        const { providerId, model } = decodeModelPin(modelOverride);
        if (!model) {
            return undefined;
        }
        return providerId === activeProvider?.id ? model : undefined;
    }, [modelOverride, activeProvider]);

    /**
     * The provider and model the Tools picker and the trifecta badge must answer
     * for. While a prompt is loaded, the grant being edited is that prompt's
     * persisted configuration and its autonomous runs resolve the pinned
     * provider, so the pin is the right question. In plain chat the send always
     * runs on the active provider with {@link sendModel}, so asking the pinned
     * provider would offer hosted names the executing provider cannot host.
     *
     * `providerId` stays null in the interactive case so the request resolves
     * whichever provider is active when it lands.
     */
    const hostedToolContext = useMemo(
        () => (editingPrompt
            ? decodeModelPin(modelOverride)
            : { providerId: null as string | null, model: sendModel ?? null }),
        [editingPrompt, modelOverride, sendModel]
    );

    // Load the provider-hosted tools for the provider and model that will actually
    // consume this grant, so the picker offers exactly what the run could call.
    // A quiet failure empties the hosted group, which grants nothing — the safe
    // direction — and never breaks the chat.
    useEffect(() => {
        const { providerId, model } = hostedToolContext;
        let cancelled = false;
        void (async () => {
            try {
                const list = await listHostedTools(providerId ?? undefined, model ?? undefined);
                if (!cancelled) {
                    setHostedTools(list);
                }
            } catch {
                if (!cancelled) {
                    setHostedTools([]);
                }
            }
        })();
        return () => { cancelled = true; };
    }, [hostedToolContext]);

    /**
     * Whether the composer's pin names a provider that is not the active one — the
     * case {@link sendModel} drops. Surfaced beside the picker so the operator is
     * never left wondering why a different model answered.
     */
    const pinnedProviderInactive = useMemo(() => {
        const { providerId } = decodeModelPin(modelOverride);
        return providerId !== null && providerId !== activeProvider?.id;
    }, [modelOverride, activeProvider]);

    /** Whether any prompt carries an enabled trigger; gates the refresh poll. */
    const hasActiveSchedule = useMemo(
        () => savedPrompts.some(prompt => (prompt.triggers ?? []).some(trigger => trigger.enabled)),
        [savedPrompts]
    );

    // Refetch the library while a schedule is live so a backend-written
    // `lastRunAt` surfaces without a manual refresh. Errors are swallowed — the
    // next tick retries — and only the stored list is replaced, so an in-progress
    // edit in the strip or the triggers panel is never disturbed.
    useEffect(() => {
        if (!hasActiveSchedule) {
            return;
        }
        const id = setInterval(() => {
            // Two writers share `savedPrompts`: this poll and the save response.
            // Discarding any response whose generation is stale makes the save
            // the winner without serialising the two.
            const generation = savedPromptsWriteRef.current;
            listSavedPrompts()
                .then(list => {
                    if (isMountedRef.current && savedPromptsWriteRef.current === generation) {
                        setSavedPrompts(list);
                    }
                })
                .catch(() => {});
        }, SAVED_PROMPT_REFRESH_MS);
        return () => clearInterval(id);
    }, [hasActiveSchedule]);

    /**
     * Every allowlist entry that is currently switched on — the display-only
     * pre-fill set for a prompt that restricts nothing. The hosted entries belong
     * here as much as the registry ones: a prompt with no allowlist really does
     * run with the provider's hosted tools.
     */
    const enabledToolNames = useMemo(
        () => [
            ...tools.filter(tool => tool.enabled).map(tool => tool.name),
            ...hostedTools.map(tool => hostedToolEntry(tool.name))
        ],
        [tools, hostedTools]
    );

    /**
     * Whether the Tools picker should show the pre-fill. True for an editor whose
     * prompt carries no explicit allowlist — a stored prompt with `undefined`, or
     * a brand-new one — and only while the operator has not engaged the picker.
     */
    const needsToolPrefill = editingPrompt
        && !toolsTouched
        && (loadedPrompt ? loadedPrompt.toolAllowlist === undefined : true);

    // Show every enabled tool for a prompt that restricts none. Display only:
    // `toolsTouched` stays false, so the save path still writes `null`. The
    // equality bail matters as much as the fill: without it each poll response
    // would rewrite an identical array and re-issue the trifecta preview.
    useEffect(() => {
        if (!needsToolPrefill || enabledToolNames.length === 0) {
            return;
        }
        setToolSelection(prev => (
            prev.length === enabledToolNames.length && prev.every(name => enabledToolNames.includes(name))
                ? prev
                : enabledToolNames
        ));
    }, [needsToolPrefill, enabledToolNames]);

    /**
     * Whether the editor holds changes the stored prompt does not have yet,
     * across every field the single Save writes. Drives the unsaved dot and
     * gates the discard guard below.
     */
    const promptDirty = useMemo(() => editingPrompt && isPromptDirty(loadedPrompt, {
        name: promptName,
        body: input,
        modelPin: modelOverride,
        toolSelection,
        toolsTouched,
        triggers: triggerDrafts
    }), [editingPrompt, loadedPrompt, promptName, input, modelOverride, toolSelection, toolsTouched, triggerDrafts]);

    /**
     * Run an action that would overwrite the editor, asking first when there are
     * unsaved changes. Every entry point that replaces editor state — loading
     * another prompt, New chat, closing the strip, opening a past conversation —
     * routes through here, because those edits are invisible once discarded and
     * the unsaved dot is the only warning an operator ever gets. Passes straight
     * through when nothing is dirty, so the common path stays one click.
     *
     * @param action - The state-replacing work to run once it is safe.
     */
    const guardUnsavedPrompt = useCallback((action: () => void) => {
        if (!promptDirty) {
            action();
            return;
        }
        const modalId = modal.open({
            title: 'Discard unsaved changes?',
            size: 'sm',
            dismissible: true,
            content: (
                <div className={promptStyles.confirm}>
                    <p className={promptStyles.confirm_text}>
                        This prompt has edits that have not been saved. Continuing discards them.
                    </p>
                    <div className={promptStyles.confirm_actions}>
                        <Button variant="ghost" size="xs" onClick={() => modal.close(modalId)}>
                            Keep editing
                        </Button>
                        <Button
                            variant="danger"
                            size="xs"
                            onClick={() => { modal.close(modalId); action(); }}
                        >
                            Discard changes
                        </Button>
                    </div>
                </div>
            )
        });
    }, [promptDirty, modal]);

    // Preview the lethal-trifecta posture of the current selection, but only
    // while the Tools dropdown is open, debounced so rapid toggling issues one
    // request. The request travels with the same pair the picker resolved its
    // hosted tools from, so the badge and the list can never disagree about
    // which provider is in play.
    useEffect(() => {
        if (!toolsOpen) {
            return;
        }
        const { providerId, model } = hostedToolContext;
        let cancelled = false;
        setTrifectaLoading(true);
        const timer = setTimeout(() => {
            void (async () => {
                try {
                    const status = await getTrifectaPreview(toolSelection, providerId ?? undefined, model ?? undefined);
                    if (!cancelled) {
                        setTrifecta(status);
                    }
                } catch {
                    if (!cancelled) {
                        setTrifecta(null);
                    }
                } finally {
                    if (!cancelled) {
                        setTrifectaLoading(false);
                    }
                }
            })();
        }, 350);
        return () => { cancelled = true; clearTimeout(timer); };
    }, [toolSelection, toolsOpen, hostedToolContext]);

    /**
     * Mutate a single turn in place by id. Used by the stream handler to append
     * text and finalize usage/error on the pending assistant turn. Every other
     * turn is returned as the same object, which is what lets the memoised turn
     * components skip re-rendering on each chunk.
     *
     * @param id - Target turn id.
     * @param patch - Partial turn, or a function producing one from the prior turn.
     */
    const updateTurn = useCallback((
        id: string,
        patch: Partial<IChatTurn> | ((turn: IChatTurn) => Partial<IChatTurn>)
    ) => {
        setMessages(prev => prev.map(turn => {
            if (turn.id !== id) {
                return turn;
            }
            const resolved = typeof patch === 'function' ? patch(turn) : patch;
            return { ...turn, ...resolved };
        }));
    }, []);

    /**
     * Record which conversation the transcript shows, in the ref the send path
     * reads, in the state the rail highlights, and in the address bar so a
     * refresh or a shared link reopens it. One helper so the three cannot drift.
     *
     * @param id - The conversation id, or null for an empty chat.
     */
    const setConversation = useCallback((id: string | null) => {
        conversationIdRef.current = id;
        setActiveConversationId(id);
        writeAiToolsSearchParam('conversation', id);
    }, []);

    /**
     * Load a conversation's tool-invocation audit records so the transcript's tool
     * calls can deep-link to their exact invocation detail. Secondary data — a
     * failure just leaves the audit affordances absent, never blocks the chat.
     *
     * @param conversationId - The conversation whose tool calls to load.
     */
    const refreshConversationActivity = useCallback(async (conversationId: string) => {
        try {
            const page = await listActivity({ conversationId, limit: 200 });
            // Drop out-of-order responses: a slower fetch for a conversation the
            // operator has since navigated away from must not overwrite the
            // active conversation's records.
            if (isMountedRef.current && conversationId === conversationIdRef.current) {
                setConversationRecords(page.records);
            }
        } catch {
            /* secondary data — the transcript still renders without audit links */
        }
    }, []);

    /** Load the first page of the conversation rail, replacing what is there. */
    const loadHistory = useCallback(async () => {
        setHistoryLoading(true);
        try {
            const page = await getQueryHistory({ limit: HISTORY_PAGE_SIZE });
            if (!isMountedRef.current) {
                return;
            }
            setHistoryRecords(page.records);
            setHistoryTotal(page.total);
            setHistoryError(null);
        } catch (err) {
            if (isMountedRef.current) {
                setHistoryError(err instanceof Error ? err.message : 'Failed to load conversations');
            }
        } finally {
            if (isMountedRef.current) {
                setHistoryLoading(false);
            }
        }
    }, []);

    /**
     * Append the next page of history to the rail. Pages by record offset, which
     * is what the endpoint offers; a conversation straddling two pages simply
     * gains its older turns when the second page lands, since the rows are
     * regrouped from the whole accumulated list.
     */
    const loadMoreHistory = useCallback(async () => {
        setHistoryLoadingMore(true);
        try {
            const page = await getQueryHistory({ limit: HISTORY_PAGE_SIZE, offset: historyRecords.length });
            if (!isMountedRef.current) {
                return;
            }
            setHistoryRecords(prev => [...prev, ...page.records]);
            setHistoryTotal(page.total);
        } catch (err) {
            if (isMountedRef.current) {
                setHistoryError(err instanceof Error ? err.message : 'Failed to load more conversations');
            }
        } finally {
            if (isMountedRef.current) {
                setHistoryLoadingMore(false);
            }
        }
    }, [historyRecords.length]);

    // The rail is populated on mount so a past conversation is one click away
    // from the first paint, rather than behind a view switch.
    useEffect(() => {
        void loadHistory();
    }, [loadHistory]);

    /**
     * Route an incoming stream chunk to the pending assistant turn. Filters by
     * the active queryId so a stale or unrelated query's chunks are ignored.
     * The backend addresses `ai-tools:query-stream` to the requesting socket, so
     * this filter is not what keeps another operator's run out — it is what
     * keeps *this* socket's own runs apart.
     *
     * @param chunk - The stream chunk payload.
     */
    const handleStreamChunk = useCallback((chunk: IAiStreamChunk) => {
        if (!isMountedRef.current || chunk.queryId !== activeQueryIdRef.current) {
            return;
        }
        const turnId = streamingTurnIdRef.current;
        if (!turnId) {
            return;
        }
        if (chunk.type === 'chunk' && chunk.text) {
            const text = chunk.text;
            // `content` stays the flat answer (the copy button reads it);
            // `segments` is that same text placed in the live structure, so prose
            // arriving after a tool call renders below that call.
            updateTurn(turnId, turn => ({
                content: turn.content + text,
                segments: appendLiveText(turn.segments, text)
            }));
        } else if (chunk.type === 'segment' && chunk.segment) {
            // A tool call or its result, reported the moment it settled. Append
            // in arrival order — the order things actually happened.
            const segment = chunk.segment;
            updateTurn(turnId, turn => ({ segments: [...(turn.segments ?? []), segment] }));
        } else if (chunk.type === 'done') {
            setStreaming(false);
            // Adopt the finalized transcript so the just-completed turn shows the
            // same thinking/tool structure history does, without a reload.
            updateTurn(turnId, {
                pending: false,
                usage: chunk.usage ?? null,
                costUsd: chunk.costUsd ?? null,
                ...(chunk.transcript && chunk.transcript.length > 0 ? { segments: chunk.transcript } : {})
            });
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
            // The turn produced its audit records as it ran; pull them so the
            // just-completed tool calls gain their "Details" deep-link. The rail
            // refreshes too, so the conversation appears there with its new turn.
            const settledConversationId = conversationIdRef.current;
            if (settledConversationId) {
                void refreshConversationActivity(settledConversationId);
            }
            void loadHistory();
        } else if (chunk.type === 'error') {
            setStreaming(false);
            updateTurn(turnId, { pending: false, error: chunk.error || 'An unknown error occurred' });
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
        }
    }, [updateTurn, refreshConversationActivity, loadHistory]);

    // Subscribe to the global stream event once; correlation happens in the
    // handler. The shared socket is reused across the app, so only detach our
    // own listener on unmount — never disconnect the socket.
    useEffect(() => {
        const socket = getSocket();
        socket.on(QUERY_STREAM_EVENT, handleStreamChunk);
        return () => { socket.off(QUERY_STREAM_EVENT, handleStreamChunk); };
    }, [handleStreamChunk]);

    // Keep the view where the reader wants it as the transcript changes. A send
    // has asked for its new message to be anchored at the top of the pane, so
    // the answer streams into the space beneath it; otherwise the live edge is
    // followed only while the reader is already there.
    //
    // Skip all of it while the tab is hidden. The sibling tabs keep this one
    // mounted behind `hidden`, so the transcript has no layout box and every
    // measurement reads zero: the scroll would not move, and the hook's one-shot
    // "this scroll was mine" flag would be left set for the next real scroll to
    // swallow. Streaming carries on while hidden, so `active` is a dependency
    // and the rule re-runs the moment the tab is shown again.
    useEffect(() => {
        if (!active) {
            return;
        }
        const anchorId = pendingAnchorTurnIdRef.current;
        if (anchorId) {
            pendingAnchorTurnIdRef.current = null;
            const element = transcriptRef.current?.querySelector<HTMLElement>(`[data-turn-id="${anchorId}"]`);
            if (element) {
                anchorToTop(element);
                return;
            }
        }
        followIfEnabled();
    }, [messages, active, anchorToTop, followIfEnabled]);

    // Grow the composer with its text up to a cap, then scroll inside it. The
    // height is reset before measuring so the field also shrinks when text is
    // deleted. Re-run on activation because a hidden textarea measures as zero.
    useEffect(() => {
        const element = textareaRef.current;
        if (!element || !active) {
            return;
        }
        const computed = getComputedStyle(element);
        const lineHeight = Number.parseFloat(computed.lineHeight) || 20;
        const padding = (Number.parseFloat(computed.paddingTop) || 0) + (Number.parseFloat(computed.paddingBottom) || 0);
        const maxHeight = lineHeight * COMPOSER_MAX_ROWS + padding;
        element.style.height = 'auto';
        const contentHeight = element.scrollHeight;
        element.style.height = `${Math.min(contentHeight, maxHeight)}px`;
        element.style.overflowY = contentHeight > maxHeight ? 'auto' : 'hidden';
    }, [input, active]);

    /**
     * Send the composer text as the next chat turn. Snapshots the completed
     * transcript as the history payload, appends a user turn and an empty pending
     * assistant turn, then POSTs the prompt with a fresh `queryId`. Streamed
     * deltas flow into the pending turn via {@link handleStreamChunk}.
     */
    const handleSend = useCallback(async () => {
        const trimmed = input.trim();
        if (!trimmed || streaming) {
            return;
        }
        setError(null);

        // A prompt with no stored allowlist means "every enabled tool" — a state
        // the composer can only express once the registry has loaded and the
        // pre-fill has filled the picker. Sending before that resolves would
        // submit `[]`, an explicit "no tools". Enter reaches this handler past
        // the disabled Send button, so the guard belongs here too.
        if (needsToolPrefill && toolsLoading) {
            setError('Tool registry still loading — wait a moment and try again.');
            return;
        }

        // The backend scopes stream chunks to the requesting socket, so the live
        // socket id is required. It is only undefined before the deferred socket
        // connects; surface that instead of POSTing an empty value.
        const socketId = getSocket().id;
        if (!socketId) {
            setError('Live connection not ready yet — wait a moment and try again.');
            return;
        }

        // Exclude failed turns so a stream error does not poison later context.
        const priorMessages: IAiConversationMessage[] = messages
            .filter(turn => !turn.error && turn.content)
            .map(turn => ({ role: turn.role, content: turn.content }));

        if (!conversationIdRef.current) {
            setConversation(generateUUID());
        }
        const conversationId = conversationIdRef.current as string;
        // A send into a conversation the operator was waiting on ends the wait:
        // the transcript now has turns of its own.
        setAwaitingRunId(null);

        // Snapshot the grant onto the turn: `toolSelection` is cleared once the
        // send is accepted, so the turn must carry its own copy.
        const userTurn: IChatTurn = { id: generateUUID(), role: 'user', content: trimmed, tools: [...toolSelection] };
        const assistantTurnId = generateUUID();
        const assistantTurn: IChatTurn = {
            id: assistantTurnId,
            role: 'assistant',
            content: '',
            pending: true,
            // The resolved override, not the raw pin: a pin on a non-active
            // provider is not what actually answers.
            model: sendModel
        };
        pendingAnchorTurnIdRef.current = userTurn.id;
        followRef.current = true;
        setMessages(prev => [...prev, userTurn, assistantTurn]);
        // While a prompt is loaded the composer holds that prompt's body, so the
        // text stays put — clearing it would empty what Save writes.
        if (!editingPrompt) {
            setInput('');
        }

        const queryId = generateUUID();
        activeQueryIdRef.current = queryId;
        streamingTurnIdRef.current = assistantTurnId;
        setStreaming(true);

        try {
            const ack = await submitQuery({
                prompt: trimmed,
                queryId,
                socketId,
                model: sendModel,
                messages: priorMessages,
                conversationId,
                stream: true,
                // Sent verbatim: `[]` grants no tools (the default), a name list
                // grants that subset. The governor enforces it for this run.
                toolAllowlist: toolSelection
            });
            if (!(ack as IStreamAck).success) {
                throw new Error('Server did not start a streaming query.');
            }
            // Per-run grant consumed: clear the allowlist once the governor has
            // accepted this run so a later ordinary message cannot silently
            // reuse a previously granted side-effecting tool. Skipped while a
            // prompt is loaded, where the selection is that prompt's persisted
            // allowlist rather than a one-shot grant.
            if (!editingPrompt) {
                setToolSelection([]);
            }
        } catch (err) {
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
            if (!isMountedRef.current) {
                return;
            }
            setStreaming(false);
            updateTurn(assistantTurnId, {
                pending: false,
                error: err instanceof Error ? err.message : 'Failed to submit query'
            });
        }
    }, [input, streaming, messages, sendModel, editingPrompt, toolSelection, needsToolPrefill, toolsLoading, updateTurn, setConversation, followRef]);

    /**
     * Save a chat turn's prompt — together with the tools that turn was granted
     * — as a new saved prompt, from the bookmark on the turn. The point is to
     * capture a run that worked: a prompt is only reproducible alongside the
     * allowlist it ran under, so the two are persisted together.
     *
     * The saved-prompt list is re-read before naming instead of trusting local
     * state, so the generated name cannot collide with one another browser
     * created in the meantime.
     *
     * @param turn - The user turn to persist; its `content` becomes the prompt body.
     */
    const handleSaveTurnAsPrompt = useCallback(async (turn: IChatTurn) => {
        const prompt = turn.content.trim();
        if (!prompt || savingTurnId) {
            return;
        }
        setSavingTurnId(turn.id);
        try {
            const name = nextTurnPromptName(await listSavedPrompts());
            const granted = turnToolsByTurnIdRef.current.get(turn.id) ?? [];
            const updated = await saveSavedPrompt({ name, prompt, toolAllowlist: granted });
            if (!isMountedRef.current) {
                return;
            }
            savedPromptsWriteRef.current += 1;
            setSavedPrompts(updated);
            push({
                tone: 'success',
                title: 'Prompt saved',
                // Name the inert case outright rather than reporting "0 tools":
                // an empty allowlist is a deny, and a prompt that can call
                // nothing is worth flagging before it is put on a schedule.
                description: granted.length === 0
                    ? `Saved as "${name}" with no tools — it will run inert until you grant some.`
                    : granted.length === 1
                        ? `Saved as "${name}" with 1 tool.`
                        : `Saved as "${name}" with ${granted.length} tools.`
            });
        } catch (err) {
            if (!isMountedRef.current) {
                return;
            }
            push({
                tone: 'danger',
                title: 'Could not save prompt',
                description: err instanceof Error ? err.message : 'Failed to save the prompt.'
            });
        } finally {
            if (isMountedRef.current) {
                setSavingTurnId(null);
            }
        }
    }, [savingTurnId, push]);

    /**
     * Abort the in-flight streaming query via the backend cancel route. The
     * backend aborts the provider stream and emits a terminal chunk, handled
     * like any other stream end.
     */
    const handleStop = useCallback(async () => {
        const queryId = activeQueryIdRef.current;
        if (!queryId) {
            return;
        }
        try {
            await cancelQuery(queryId);
        } catch {
            // Best-effort: the stream delivers its own terminal chunk regardless.
        }
    }, []);

    /**
     * Reset the conversation surface itself — transcript, ids, and audit records.
     * Split out from {@link handleNewChat} because loading a saved prompt needs
     * exactly this much (a fresh chat to try the prompt in) and must not touch
     * the composer, which is about to receive the prompt's body.
     */
    const resetConversation = useCallback(() => {
        setMessages([]);
        setError(null);
        streamingTurnIdRef.current = null;
        activeQueryIdRef.current = null;
        setConversation(null);
        setAwaitingRunId(null);
        setConversationRecords([]);
        setSelectedRecord(null);
    }, [setConversation]);

    /**
     * Leave prompt-editing mode and clear everything the editor owned. Shared by
     * New chat, closing the strip, deleting the prompt, and opening a past
     * conversation, so the five cannot disagree about what "not editing" means.
     * The tool grant is reset with it: while editing, the selection may be the
     * display-only pre-fill of every enabled tool, which was never a grant the
     * operator made, and carrying it into the next ad-hoc message would hand a
     * one-off question every enabled tool.
     */
    const clearPromptEditor = useCallback(() => {
        setEditingPrompt(false);
        setLoadedPromptId(null);
        setPromptName('');
        setTriggerDrafts([]);
        setTriggersOpen(false);
        setToolsTouched(false);
        setToolSelection([]);
    }, []);

    /**
     * Start over completely: a fresh conversation *and* a cleared composer, model
     * pin, and tool grant, with any prompt editor dismissed. This is the escape
     * hatch from prompt-authoring mode — where the composer deliberately keeps its
     * text after a send — back to an empty least-privilege chat.
     */
    const handleNewChat = useCallback(() => {
        if (streaming) {
            return;
        }
        guardUnsavedPrompt(() => {
            resetConversation();
            setInput('');
            setModelOverride('');
            clearPromptEditor();
            textareaRef.current?.focus();
        });
    }, [streaming, resetConversation, guardUnsavedPrompt, clearPromptEditor]);

    /**
     * Load a saved prompt for editing: start a fresh chat, then fill every control
     * that makes up the prompt — composer body, model pin, tool allowlist, and
     * trigger rows. From here a single Save writes all of it back.
     *
     * The allowlist seeding carries the three-state contract: a prompt with an
     * explicit list (including `[]`) seeds verbatim, while one with none is
     * pre-filled with the enabled set for display only, leaving `toolsTouched`
     * false so an untouched save still writes `null`.
     *
     * @param prompt - The prompt picked from the header selector.
     */
    const handleSelectPrompt = useCallback((prompt: ISavedPrompt) => {
        if (streaming) {
            return;
        }
        guardUnsavedPrompt(() => {
            resetConversation();
            setInput(prompt.prompt);
            setPromptName(prompt.name);
            setModelOverride(encodeModelPin(prompt));
            // `??` not `||`: a stored `[]` is a deliberate "no tools" and must
            // survive, where the pre-fill effect handles the `undefined` case.
            setToolSelection(prompt.toolAllowlist ?? []);
            setToolsTouched(false);
            setTriggerDrafts(toTriggerDrafts(prompt.triggers));
            setLoadedPromptId(prompt.id);
            setEditingPrompt(true);
            setTriggersOpen(false);
            textareaRef.current?.focus();
        });
    }, [streaming, resetConversation, guardUnsavedPrompt]);

    /**
     * Begin a new saved prompt from what is already in the composer. Deliberately
     * keeps the composer text, model choice, and tool grant — "from composer" is
     * the whole affordance, and it is how a query an operator just tuned by hand
     * becomes a reusable prompt without retyping it.
     */
    const handleCreateNewPrompt = useCallback(() => {
        guardUnsavedPrompt(() => {
            setLoadedPromptId(null);
            setPromptName('');
            setTriggerDrafts([]);
            // Only an actual grant counts as intent. Forcing this true would make
            // the composer's least-privilege default (`[]`) save as a hard deny.
            setToolsTouched(toolSelection.length > 0);
            setEditingPrompt(true);
            setTriggersOpen(false);
        });
    }, [guardUnsavedPrompt, toolSelection]);

    /**
     * Stop editing without altering the conversation. The composer keeps its text
     * — an operator dismissing the strip is stepping out of prompt-editing mode,
     * not discarding the query they were working on.
     */
    const handleCloseEditor = useCallback(() => {
        guardUnsavedPrompt(clearPromptEditor);
    }, [guardUnsavedPrompt, clearPromptEditor]);

    /**
     * Record a real selection edit and update the grant. Wraps the tool dropdown's
     * onChange so every toggle marks the selection as engaged — distinguishing a
     * deliberate choice from the display-only pre-fill.
     *
     * @param names - The next selected tool names from the picker.
     */
    const handleToolSelectionChange = useCallback((names: string[]) => {
        setToolsTouched(true);
        setToolSelection(names);
    }, []);

    /**
     * Persist the whole prompt in one write — name, body, model pin, tool
     * allowlist, and triggers. One Save because the operator edits all of it in
     * one surface; sending every field together also means the stored document
     * always matches what the card is showing, which is what the unsaved
     * indicator promises.
     */
    const handleSavePrompt = useCallback(async () => {
        const trimmedName = promptName.trim();
        const trimmedBody = input.trim();
        if (!trimmedName || !trimmedBody) {
            return;
        }
        setPromptSaving(true);
        try {
            const { providerId, model } = decodeModelPin(modelOverride);
            const saved = await saveSavedPrompt({
                ...(loadedPromptId ? { id: loadedPromptId } : {}),
                name: trimmedName,
                prompt: trimmedBody,
                providerId,
                model,
                toolAllowlist: resolveToolAllowlistForSave(loadedPrompt, toolSelection, toolsTouched),
                triggers: toTriggerRequests(triggerDrafts)
            });
            if (!isMountedRef.current) {
                return;
            }
            savedPromptsWriteRef.current += 1;
            setSavedPrompts(saved);
            // Adopt the server's identity and its normalized triggers. A create
            // has no id to match on, so it is found by name — the backend's
            // unique index is case-insensitive, so this cannot be ambiguous.
            const stored = loadedPromptId
                ? saved.find(prompt => prompt.id === loadedPromptId)
                : saved.find(prompt => prompt.name.toLowerCase() === trimmedName.toLowerCase());
            if (stored) {
                setLoadedPromptId(stored.id);
                setTriggerDrafts(toTriggerDrafts(stored.triggers));
                // The stored document is the new baseline, so intent is recorded
                // in it now rather than in this flag.
                setToolsTouched(false);
            }
            push({
                tone: 'success',
                title: loadedPromptId ? 'Prompt updated' : 'Prompt created',
                description: `"${trimmedName}" saved.`
            });
        } catch (err) {
            if (isMountedRef.current) {
                push({
                    tone: 'danger',
                    title: 'Could not save prompt',
                    description: err instanceof Error ? err.message : 'Failed to save the prompt.'
                });
            }
        } finally {
            if (isMountedRef.current) {
                setPromptSaving(false);
            }
        }
    }, [promptName, input, modelOverride, loadedPromptId, loadedPrompt, toolSelection, toolsTouched, triggerDrafts, push]);

    /**
     * Duplicate the prompt under an auto-suffixed name. The candidate is compared
     * lowercased because the backend's unique-name index is case-insensitive, so
     * a case-variant match must count as a collision here too.
     */
    const handleDuplicatePrompt = useCallback(async () => {
        if (!loadedPrompt) {
            return;
        }
        const existingNames = new Set(savedPrompts.map(prompt => prompt.name.toLowerCase()));
        let candidate = `${loadedPrompt.name} (copy)`;
        let counter = 2;
        while (existingNames.has(candidate.toLowerCase())) {
            candidate = `${loadedPrompt.name} (copy ${counter})`;
            counter += 1;
        }
        try {
            // Carry the model pin and the allowlist, not just name + body: an
            // omitted `toolAllowlist` reads as "every enabled tool", so copying a
            // narrowly-scoped prompt without it would hand the copy more privilege
            // than the original. Triggers are deliberately NOT copied: a duplicate
            // that inherits a cron would start firing on a schedule nobody asked for.
            const duplicated = await saveSavedPrompt({
                name: candidate,
                prompt: loadedPrompt.prompt,
                providerId: loadedPrompt.providerId ?? null,
                model: loadedPrompt.model ?? null,
                toolAllowlist: loadedPrompt.toolAllowlist ?? null
            });
            savedPromptsWriteRef.current += 1;
            setSavedPrompts(duplicated);
            push({
                tone: 'success',
                title: 'Prompt duplicated',
                description: `Created "${candidate}" with the same model and tools. Triggers were not copied.`
            });
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to duplicate prompt');
        }
    }, [loadedPrompt, savedPrompts, push]);

    /**
     * Delete the prompt under edit and dismiss the editor. Called only from the
     * confirm dialog below.
     *
     * @param id - The prompt id to delete.
     */
    const handleDeletePrompt = useCallback(async (id: string) => {
        try {
            await deleteSavedPrompt(id);
            savedPromptsWriteRef.current += 1;
            setSavedPrompts(prev => prev.filter(prompt => prompt.id !== id));
            // Straight to the raw reset: the document is gone, so there is nothing
            // left for the discard guard to protect.
            clearPromptEditor();
        } catch (err) {
            setError(err instanceof Error ? err.message : 'Failed to delete prompt');
        }
    }, [clearPromptEditor]);

    /**
     * Confirm before deleting, calling out attached triggers. Deleting a prompt
     * that something is scheduled to fire is not an action to take on a stray
     * click, and the consequence (a schedule silently stopping) is invisible from
     * the strip.
     */
    const confirmDeletePrompt = useCallback(() => {
        if (!loadedPrompt) {
            return;
        }
        const prompt = loadedPrompt;
        const triggers = prompt.triggers ?? [];
        const scheduleIsActive = triggers.some(trigger => trigger.enabled);
        const modalId = modal.open({
            title: 'Delete saved prompt?',
            size: 'sm',
            dismissible: true,
            content: (
                <div className={promptStyles.confirm}>
                    <p className={promptStyles.confirm_text}>
                        Delete <strong>{prompt.name}</strong>? This cannot be undone.
                    </p>
                    {scheduleIsActive && (
                        <p className={promptStyles.confirm_warning}>
                            <AlertTriangle size={14} /> Active triggers will stop firing.
                        </p>
                    )}
                    {triggers.length > 0 && !scheduleIsActive && (
                        <p className={promptStyles.confirm_warning}>
                            <AlertTriangle size={14} /> Paused triggers will be removed with the prompt.
                        </p>
                    )}
                    <div className={promptStyles.confirm_actions}>
                        <Button variant="ghost" size="xs" onClick={() => modal.close(modalId)}>
                            Cancel
                        </Button>
                        <Button
                            variant="danger"
                            size="xs"
                            onClick={() => { modal.close(modalId); void handleDeletePrompt(prompt.id); }}
                        >
                            <Trash2 size={12} /> Delete
                        </Button>
                    </div>
                </div>
            )
        });
    }, [modal, loadedPrompt, handleDeletePrompt]);

    /**
     * Copy arbitrary text to the clipboard, flashing a check on whichever control
     * triggered it. Shared by the transcript's per-turn copy and the rail's
     * per-conversation copy so both get identical 2-second confirmation from one
     * timer and one piece of "last copied" state.
     *
     * @param id - Id of the control to flash (a turn id or a conversation id).
     * @param text - The text to place on the clipboard.
     */
    const handleCopy = useCallback(async (id: string, text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            if (copyTimerRef.current) {
                clearTimeout(copyTimerRef.current);
            }
            copyTimerRef.current = setTimeout(() => {
                if (isMountedRef.current) {
                    setCopiedId(null);
                }
            }, 2000);
        } catch {
            setError('Could not copy to clipboard');
        }
    }, []);

    /**
     * Open a past conversation in the transcript. Fetches every turn
     * (oldest-first), rebuilds user/assistant bubbles, and records the
     * conversation id so continued turns extend the same thread. Any prompt
     * editing ends: the operator has moved into an unrelated thread that the
     * next send would extend, so keeping the strip up would claim they are still
     * authoring a prompt while the surface below says otherwise. Callers clear
     * the discard guard first.
     *
     * @param conversationId - Id of the conversation to open.
     */
    const openConversation = useCallback(async (conversationId: string) => {
        // If a stream is still in flight, abort it before abandoning the current
        // transcript — otherwise the server query keeps consuming tokens after the
        // user has navigated away from it.
        const inFlightQueryId = activeQueryIdRef.current;
        if (inFlightQueryId) {
            activeQueryIdRef.current = null;
            streamingTurnIdRef.current = null;
            setStreaming(false);
            try {
                await cancelQuery(inFlightQueryId);
            } catch {
                // Best-effort: the queryId filter already discards the abandoned
                // stream's chunks on this client.
            }
            if (!isMountedRef.current) {
                return;
            }
        }
        try {
            const records = await getConversation(conversationId);
            if (!isMountedRef.current) {
                return;
            }
            setStreaming(false);
            setError(null);
            streamingTurnIdRef.current = null;
            activeQueryIdRef.current = null;
            setConversation(conversationId);
            setMessages(recordsToChatTurns(records));
            clearPromptEditor();
            // Drop the previous conversation's audit records up front so the
            // transcript's tool-detail lookup never shows the prior thread's
            // tools during this conversation's in-flight activity fetch.
            setConversationRecords([]);
            setSelectedRecord(null);
            followRef.current = true;
            void refreshConversationActivity(conversationId);
        } catch (err) {
            if (isMountedRef.current) {
                setError(err instanceof Error ? err.message : 'Failed to open conversation');
            }
        }
    }, [refreshConversationActivity, setConversation, clearPromptEditor, followRef]);

    // Apply the `?conversation=` deep link once, after mount, so a refreshed or
    // shared address lands on the same thread. Guarded by a ref because the
    // callback identity can change and the effect must not reopen it.
    useEffect(() => {
        if (!initialConversationId || initialOpenedRef.current) {
            return;
        }
        initialOpenedRef.current = true;
        void openConversation(initialConversationId);
    }, [initialConversationId, openConversation]);

    /**
     * Open a conversation from the rail, asking first if the editor holds
     * unsaved changes. A row click is the common path, so it stays one click
     * whenever there is nothing to lose.
     *
     * @param conversationId - The row's conversation id.
     */
    const handleOpenFromRail = useCallback((conversationId: string) => {
        guardUnsavedPrompt(() => {
            setAwaitingRunId(null);
            void openConversation(conversationId);
        });
    }, [guardUnsavedPrompt, openConversation]);

    /**
     * Execute a saved prompt immediately — a self-contained autonomous run,
     * exactly as its schedule would fire it. It runs server-side (programmatic
     * mode, the prompt's own tools, its owner principal) rather than in this
     * interactive conversation. The POST returns as soon as the run is accepted
     * with the conversation id the result will land under, so the toast can
     * offer to open it: the chat then shows the run as in progress and picks the
     * result up when the history row is written.
     *
     * @param sp - The saved prompt to run now.
     */
    const handleRunSavedPrompt = useCallback(async (sp: ISavedPrompt) => {
        try {
            const conversationId = await runSavedPromptNow(sp.id);
            push({
                tone: 'success',
                title: 'Prompt run started',
                description: `"${sp.name}" is running autonomously. It can take a few minutes.`,
                actionLabel: 'Open result',
                onAction: () => {
                    guardUnsavedPrompt(() => {
                        setAwaitingRunId(conversationId);
                        void openConversation(conversationId);
                    });
                }
            });
        } catch (err) {
            push({
                tone: 'danger',
                title: 'Could not run prompt',
                description: err instanceof Error ? err.message : 'Failed to start the run.'
            });
        }
    }, [push, guardUnsavedPrompt, openConversation]);

    // Watch for the result of a run-now the operator chose to open early. The
    // run writes one history row when it settles and emits no signal, so the
    // conversation is polled until it has turns, the wait expires, or the
    // operator moves to another conversation.
    useEffect(() => {
        if (!awaitingRunId) {
            return;
        }
        const startedAt = Date.now();
        const id = setInterval(() => {
            if (!isMountedRef.current) {
                return;
            }
            if (conversationIdRef.current !== awaitingRunId || Date.now() - startedAt > PENDING_RUN_POLL_LIMIT_MS) {
                setAwaitingRunId(null);
                return;
            }
            getConversation(awaitingRunId)
                .then(records => {
                    if (!isMountedRef.current || records.length === 0 || conversationIdRef.current !== awaitingRunId) {
                        return;
                    }
                    setMessages(recordsToChatTurns(records));
                    setAwaitingRunId(null);
                    void refreshConversationActivity(awaitingRunId);
                    void loadHistory();
                })
                .catch(() => {
                    /* transient — the next tick retries */
                });
        }, PENDING_RUN_POLL_MS);
        return () => clearInterval(id);
    }, [awaitingRunId, refreshConversationActivity, loadHistory]);

    /**
     * Enter submits from the composer; Shift+Enter inserts a newline, which is
     * the convention every mainstream chat interface follows. Ctrl or Cmd with
     * Enter still sends for anyone used to the old binding. A keystroke that is
     * part of an input-method composition (typing Chinese or Japanese) is left
     * alone, because Enter there confirms the composed text rather than the
     * message.
     *
     * @param event - Keyboard event from the textarea.
     */
    const handleKeyDown = useCallback((event: React.KeyboardEvent<HTMLTextAreaElement>) => {
        if (event.key !== 'Enter' || event.nativeEvent.isComposing || event.shiftKey) {
            return;
        }
        event.preventDefault();
        void handleSend();
    }, [handleSend]);

    const hasTurns = messages.length > 0;

    // Labels span every provider's catalog, not just the active one: a turn
    // reopened from history may name a model whose provider is no longer active.
    const modelLabel = useMemo(
        () => new Map(providers.flatMap(provider => provider.models).map(model => [model.id, model.display_name])),
        [providers]
    );

    /**
     * Why Save is unavailable, or null when it is available. Returned as prose
     * rather than a boolean because the blocking condition can live in a section
     * the operator is not looking at, and a Save that is greyed out for no
     * visible reason reads as a bug.
     */
    const saveBlockedReason = useMemo(() => {
        if (!promptName.trim()) {
            return 'Give the prompt a name before saving.';
        }
        if (!input.trim()) {
            return 'The composer is empty — it holds this prompt’s text.';
        }
        if (hasInvalidTriggerDraft(triggerDrafts)) {
            return 'A trigger is incomplete — open Triggers to fix it.';
        }
        return null;
    }, [promptName, input, triggerDrafts]);

    // Running conversation cost: sum every priced turn. `null` when not a single
    // turn could be priced, so the header hides the figure rather than showing
    // a misleading $0.00.
    const conversationCost = useMemo(() => {
        let total = 0;
        let priced = false;
        for (const turn of messages) {
            if (typeof turn.costUsd === 'number') {
                total += turn.costUsd;
                priced = true;
            }
        }
        return priced ? total : null;
    }, [messages]);

    /** The conversation's name in the header: its opening prompt, or a placeholder. */
    const conversationTitle = useMemo(() => {
        const first = messages.find(turn => turn.role === 'user');
        return first ? first.content.trim().replace(/\s+/g, ' ') : 'New conversation';
    }, [messages]);

    /** Feeds the measured page offset to the stylesheet, which sizes the pane from it. */
    const workspaceStyle = paneTop !== null
        ? { '--query-chat-top': `${paneTop}px` } as CSSProperties
        : undefined;

    return (
        <div className={styles.query}>
            <div className={styles.provider_line}>
                <Bot size={16} className={styles.chat_header_icon} />
                <span>
                    {activeProvider
                        ? <>Active provider ready — <span className={styles.provider_label}>{activeProvider.models.length}</span> model{activeProvider.models.length === 1 ? '' : 's'} available.</>
                        : 'No active AI provider is installed — install and enable a provider plugin to run queries.'}
                </span>
            </div>

            <div
                ref={workspaceRef}
                className={`${styles.workspace} ${railOpen ? styles.workspace_rail_open : ''}`}
                style={workspaceStyle}
            >
                {railOpen && (
                    <ConversationRail
                        groups={conversations}
                        activeConversationId={activeConversationId}
                        loading={historyLoading}
                        error={historyError}
                        hasMore={hasMoreHistory}
                        loadingMore={historyLoadingMore}
                        onOpen={handleOpenFromRail}
                        onLoadMore={() => { void loadMoreHistory(); }}
                        onRefresh={() => { void loadHistory(); }}
                        onCopy={(id, text) => { void handleCopy(id, text); }}
                        copiedId={copiedId}
                    />
                )}

                <Card className={styles.chat_card}>
                    <div className={styles.chat_header}>
                        <IconButton
                            variant="ghost"
                            size="sm"
                            onClick={() => setRailOpen(open => !open)}
                            aria-expanded={railOpen}
                            aria-label={railOpen ? 'Hide past conversations' : 'Show past conversations'}
                            title={railOpen ? 'Hide conversations' : 'Show conversations'}
                        >
                            <PanelLeft size={16} />
                        </IconButton>
                        <span className={styles.chat_title} title={conversationTitle}>{conversationTitle}</span>
                        <SavedPromptSelector
                            prompts={savedPrompts}
                            loadedPromptId={loadedPromptId}
                            onSelect={handleSelectPrompt}
                            onCreateNew={handleCreateNewPrompt}
                            disabled={streaming}
                        />
                        {conversationCost != null && (
                            <span
                                className={styles.conversation_cost}
                                title="Estimated total cost of this conversation, summed across turns at the provider's per-model rates."
                            >
                                ≈ {formatUsd(conversationCost)}
                            </span>
                        )}
                        {streaming && (
                            <span className={styles.streaming_indicator}>
                                <span className={styles.streaming_dot} aria-hidden="true" />
                                Streaming
                            </span>
                        )}
                        <div className={styles.chat_header_actions}>
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={handleNewChat}
                                disabled={streaming || (!hasTurns && !editingPrompt && !input && !awaitingRunId)}
                                aria-label="Start a new conversation"
                            >
                                <Plus size={16} /> New chat
                            </Button>
                        </div>
                    </div>

                    <div className={styles.transcript_wrap}>
                        <div
                            ref={transcriptRef}
                            className={styles.transcript}
                            role="log"
                            aria-live="polite"
                            aria-busy={streaming}
                            aria-label="Conversation transcript"
                        >
                            {error && (
                                <div className={styles.chat_error} role="alert">
                                    <AlertCircle size={16} className={styles.chat_error_icon} />
                                    <span>{error}</span>
                                </div>
                            )}

                            {hasTurns ? (
                                messages.map(turn => (
                                    <TranscriptTurn
                                        key={turn.id}
                                        turn={turn}
                                        recordsById={toolRecordsById}
                                        onSelectRecord={setSelectedRecord}
                                        modelLabel={modelLabel}
                                        copied={copiedId === turn.id}
                                        onCopy={handleCopy}
                                        tools={turn.role === 'user' ? turnToolsByTurnId.get(turn.id) : undefined}
                                        calledTools={turn.role === 'user' ? calledToolsByTurnId.get(turn.id) : undefined}
                                        onSaveAsPrompt={turn.role === 'user' ? handleSaveTurnAsPrompt : undefined}
                                        saveDisabled={savingTurnId !== null}
                                    />
                                ))
                            ) : (
                                !error && (
                                    <div className={styles.empty_state}>
                                        <Bot size={24} className={styles.empty_state_icon} />
                                        <span>
                                            {awaitingRunId
                                                ? 'This run is in progress. Its result will appear here when it finishes.'
                                                : 'Start a conversation with the active AI provider. Responses stream in live.'}
                                        </span>
                                    </div>
                                )
                            )}

                            {unlinkedRecords.length > 0 && (
                                // Invocations the transcript above cannot link to, because they
                                // carry no `toolUseId` to pair with a call. Without this block
                                // their detail would be unreachable from the chat view.
                                <div className={styles.unlinked_records}>
                                    <span className={styles.unlinked_records_note}>
                                        Tool calls this transcript cannot link to
                                    </span>
                                    <InvocationTable records={unlinkedRecords} onSelect={setSelectedRecord} />
                                </div>
                            )}
                        </div>

                        {hasTurns && !atBottom && (
                            <button
                                type="button"
                                className={styles.scroll_to_bottom}
                                onClick={scrollToBottom}
                                aria-label="Jump to the latest message"
                            >
                                <ArrowDown size={14} /> Latest
                            </button>
                        )}
                    </div>

                    {editingPrompt && triggersOpen && (
                        <div className={styles.triggers_panel}>
                            <PromptTriggersEditor
                                promptId={loadedPromptId ?? 'new'}
                                drafts={triggerDrafts}
                                onChange={setTriggerDrafts}
                                stored={loadedPrompt?.triggers ?? []}
                                bindableHooks={bindableHooks}
                                disabled={promptSaving}
                            />
                        </div>
                    )}

                    {editingPrompt && (
                        <PromptEditorBar
                            prompt={loadedPrompt}
                            name={promptName}
                            onNameChange={setPromptName}
                            dirty={promptDirty}
                            saving={promptSaving}
                            saveBlockedReason={saveBlockedReason}
                            onSave={() => { void handleSavePrompt(); }}
                            runBlockedReason={promptDirty
                                ? 'Save first — Run executes the stored prompt, not your unsaved edits.'
                                : null}
                            onRun={() => { if (loadedPrompt) { void handleRunSavedPrompt(loadedPrompt); } }}
                            onDuplicate={() => { void handleDuplicatePrompt(); }}
                            onDelete={confirmDeletePrompt}
                            onClose={handleCloseEditor}
                            triggersOpen={triggersOpen}
                            onToggleTriggers={() => setTriggersOpen(open => !open)}
                            triggerCount={triggerDrafts.length}
                        />
                    )}

                    <div className={styles.composer}>
                        <div className={styles.composer_box}>
                            <Textarea
                                ref={textareaRef}
                                variant="ghost"
                                size="sm"
                                value={input}
                                onChange={(e) => setInput(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder={editingPrompt
                                    ? 'Prompt text — Enter sends it as a test message, Shift+Enter adds a line'
                                    : 'Message the assistant… (Enter to send, Shift+Enter for a new line)'}
                                className={styles.composer_input}
                                rows={1}
                                aria-label="Message input"
                                disabled={streaming}
                            />
                            {grantedTools.length > 0 && (
                                <ul className={styles.composer_chips}>
                                    {grantedTools.map(name => (
                                        <li key={name}>
                                            <button
                                                type="button"
                                                className={styles.composer_chip}
                                                onClick={() => handleRevokeTool(name)}
                                                disabled={streaming}
                                                title={`Remove ${name} from this message`}
                                                aria-label={`Remove ${name} from the tools this message may call`}
                                            >
                                                {name}
                                                <X size={12} aria-hidden="true" />
                                            </button>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div className={styles.composer_footer}>
                                {providers.length > 0 && (
                                    <Select
                                        value={modelOverride}
                                        onChange={(e) => setModelOverride(e.target.value)}
                                        className={styles.model_select}
                                        aria-label="Model for the next message"
                                        title={editingPrompt
                                            ? 'Model for the next message, and the model this prompt pins for its autonomous runs'
                                            : "Model for the next message — Default uses the active provider's configured model"}
                                    >
                                        <option value="">Default model</option>
                                        {providers.map(provider => (
                                            <optgroup
                                                key={provider.id}
                                                label={provider.active ? `${provider.label} (active)` : provider.label}
                                            >
                                                {provider.models.map(model => (
                                                    <option key={`${provider.id}|${model.id}`} value={`${provider.id}|${model.id}`}>
                                                        {model.display_name}
                                                    </option>
                                                ))}
                                            </optgroup>
                                        ))}
                                    </Select>
                                )}
                                <ToolAllowlistDropdown
                                    tools={tools}
                                    hostedTools={hostedTools}
                                    selected={toolSelection}
                                    onChange={handleToolSelectionChange}
                                    trifecta={trifecta}
                                    trifectaLoading={trifectaLoading}
                                    onOpenChange={setToolsOpen}
                                    disabled={streaming}
                                    hint={editingPrompt
                                        ? 'Tools this saved prompt may call, on this message and on every autonomous run. An empty selection runs it with no tools. Provider-hosted tools are granted here too — unchecked means the request never offers them, so they cannot run. Naming a tool that is later disabled or removed fails the run.'
                                        : undefined}
                                />
                                {pinnedProviderInactive && (
                                    <span className={styles.model_pin_note}>
                                        {editingPrompt
                                            ? 'Not the active provider — applies to scheduled runs only.'
                                            : 'Not the active provider — this message runs on the active provider’s default model.'}
                                    </span>
                                )}
                                <div className={styles.composer_send}>
                                    {streaming ? (
                                        <Button
                                            variant="danger"
                                            size="sm"
                                            onClick={() => { void handleStop(); }}
                                            aria-label="Stop the in-flight response"
                                        >
                                            <Square size={14} /> Stop
                                        </Button>
                                    ) : (
                                        <Button
                                            variant="primary"
                                            size="sm"
                                            onClick={() => { void handleSend(); }}
                                            disabled={!input.trim() || (needsToolPrefill && toolsLoading)}
                                            aria-label="Send message"
                                        >
                                            <ArrowUp size={16} /> Send
                                        </Button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </Card>
            </div>

            <SlideOver
                open={selectedRecord !== null}
                onClose={() => setSelectedRecord(null)}
                label={selectedRecord ? `Invocation ${selectedRecord.toolName}` : undefined}
                title={selectedRecord ? <span className={styles.slideover_title}>{selectedRecord.toolName}</span> : null}
            >
                {selectedRecord && <InvocationDetailPanel record={selectedRecord} />}
            </SlideOver>
        </div>
    );
}
