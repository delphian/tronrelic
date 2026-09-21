/**
 * @file formatConversation.ts
 *
 * Turns a Query-tab transcript into the plain text an operator puts on the
 * clipboard. The copy control beside a conversation used to hand over only its
 * opening prompt, which is almost never what someone copying a conversation
 * wants — they are pasting a run into a ticket, a message, or a document, and
 * the answer is the part that matters.
 *
 * Three formats exist because the destinations differ. A Markdown transcript is
 * the common case. The full transcript adds the thinking and tool activity, and
 * is what you paste when you are explaining why an agentic run behaved the way
 * it did. Plain text drops the heading syntax for a field that will not render
 * Markdown.
 *
 * Pure functions with no React and no browser APIs, so the same formatting
 * serves the open transcript in the chat header and a past conversation fetched
 * from the rail.
 */

import type { IAiTranscriptSegment } from '@/types';
import type { IChatTurn } from './IChatTurn';

/** Which shape {@link formatConversation} produces. */
export type ConversationCopyFormat = 'markdown' | 'full' | 'text';

/** One selectable format, for the copy menu to render. */
export interface IConversationCopyOption {
    /** The value handed back to the caller when this row is picked. */
    format: ConversationCopyFormat;
    /** Menu item text. */
    label: string;
    /** One line under the label saying what the operator gets. */
    description: string;
}

/**
 * The formats offered in the copy menu, in the order they appear. Declared here
 * beside the formatter so a format can never be added to one without the other.
 */
export const CONVERSATION_COPY_OPTIONS: readonly IConversationCopyOption[] = [
    {
        format: 'markdown',
        label: 'Markdown',
        description: 'Prompts and answers, with headings.'
    },
    {
        format: 'full',
        label: 'Full transcript',
        description: 'Adds thinking, tool calls, and tool results.'
    },
    {
        format: 'text',
        label: 'Plain text',
        description: 'Prompts and answers, no heading syntax.'
    }
];

/** Separates one exchange from the next in the two Markdown formats. */
const EXCHANGE_RULE = '---';

/**
 * Pretty-print a tool's JSON argument or result payload. Tool input arrives as
 * an arbitrary object the model produced and a result as a string the tool
 * returned; both read best as indented JSON when they parse as such, and as raw
 * text otherwise. Kept tolerant, because formatting must never be what makes a
 * transcript uncopyable, so a stringify failure degrades to `String(value)`.
 *
 * Shared with the on-screen transcript so a copied tool payload is byte-for-byte
 * what the reader saw in the card they copied it from.
 *
 * @param value - The tool input object, or the tool result string.
 * @returns A human-readable, multi-line string.
 */
export function formatToolPayload(value: unknown): string {
    let formatted: string;
    if (typeof value === 'string') {
        try {
            formatted = JSON.stringify(JSON.parse(value), null, 2);
        } catch {
            formatted = value;
        }
    } else {
        try {
            formatted = JSON.stringify(value ?? null, null, 2);
        } catch {
            formatted = String(value);
        }
    }
    return formatted;
}

/**
 * Render one assistant turn's structured transcript as Markdown — the thinking,
 * tool calls, tool results, and answer prose in the order they happened.
 *
 * Tool payloads go in fenced code blocks so a Markdown renderer does not try to
 * read JSON braces as formatting, and so a reader can tell machine output apart
 * from the model's prose at a glance.
 *
 * @param segments - The turn's ordered segments.
 * @returns The rendered blocks, one string each, for the caller to join.
 */
function renderSegments(segments: IAiTranscriptSegment[]): string[] {
    const blocks: string[] = [];
    for (const segment of segments) {
        if (segment.type === 'thinking') {
            blocks.push(`**Thinking**\n\n> ${segment.text.split('\n').join('\n> ')}`);
        } else if (segment.type === 'tool_use') {
            const name = segment.name || 'tool';
            const where = segment.server ? ' (provider-hosted)' : '';
            blocks.push(`**Tool call: ${name}**${where}\n\n\`\`\`json\n${formatToolPayload(segment.input)}\n\`\`\``);
        } else if (segment.type === 'tool_result') {
            const heading = segment.isError ? 'Tool error' : 'Tool result';
            blocks.push(`**${heading}**\n\n\`\`\`json\n${formatToolPayload(segment.content)}\n\`\`\``);
        } else {
            blocks.push(segment.text);
        }
    }
    return blocks;
}

/**
 * Produce the body of one turn for a given format.
 *
 * Only the full format reads `segments`; the other two deliberately use the
 * flat `content`, because the point of those formats is the conversation
 * without the machinery. A turn that recorded a failure contributes its error
 * text either way — a copied transcript that silently omits the reason a turn
 * produced nothing is worse than no transcript at all.
 *
 * @param turn - The turn to render.
 * @param format - The requested shape.
 * @returns The turn's body, which is empty when the turn carried nothing.
 */
function renderTurnBody(turn: IChatTurn, format: ConversationCopyFormat): string {
    const parts: string[] = [];
    if (format === 'full' && turn.role === 'assistant' && turn.segments && turn.segments.length > 0) {
        parts.push(...renderSegments(turn.segments));
    } else if (turn.content) {
        parts.push(turn.content);
    }
    if (turn.error) {
        parts.push(format === 'text' ? `[error] ${turn.error}` : `**Error:** ${turn.error}`);
    }
    return parts.join('\n\n').trim();
}

/**
 * Render a whole conversation as clipboard text.
 *
 * A turn still streaming is included with whatever it has produced so far,
 * because an operator who copies mid-answer means to capture what is on screen.
 * A turn that is genuinely empty is skipped rather than contributing a bare
 * heading with nothing under it.
 *
 * @param turns - The transcript in order, oldest first.
 * @param format - Which of the three shapes to produce.
 * @returns The clipboard text, or an empty string for a conversation with
 *          nothing in it.
 */
export function formatConversation(turns: IChatTurn[], format: ConversationCopyFormat): string {
    const blocks: string[] = [];
    turns.forEach((turn, index) => {
        const body = renderTurnBody(turn, format);
        if (!body) {
            return;
        }
        if (format === 'text') {
            blocks.push(`${turn.role === 'user' ? 'You' : 'Assistant'}: ${body}`);
            return;
        }
        // A rule before every prompt but the first gives the reader a visible
        // boundary between exchanges, which a long run of headings alone does
        // not.
        if (turn.role === 'user' && index > 0 && blocks.length > 0) {
            blocks.push(EXCHANGE_RULE);
        }
        blocks.push(`## ${turn.role === 'user' ? 'You' : 'Assistant'}\n\n${body}`);
    });
    return blocks.join('\n\n');
}
