/**
 * @file IChatTurn.ts
 *
 * The one turn shape the Query tab renders, whether the turn is streaming live
 * or was rebuilt from a stored history record. Shared by the tab, the
 * transcript renderer, and the conversation rail so a turn reads the same
 * everywhere it appears.
 */

import type { IAiStreamChunk, IAiTranscriptSegment } from '@/types';

/**
 * One turn in the chat transcript. `pending` marks the assistant turn currently
 * receiving stream chunks (drives the blinking cursor and the Stop control);
 * `error` carries a stream failure surfaced inside the bubble; `usage`/`model`
 * are captured at finalize so per-turn detail stays correct mid-conversation.
 */
export interface IChatTurn {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    pending?: boolean;
    error?: string | null;
    model?: string;
    usage?: IAiStreamChunk['usage'] | null;
    /**
     * Provider-estimated USD cost of this turn, captured from the terminal
     * `done` chunk (or a reopened history record). `null`/absent when the
     * provider could not price it; the provider owns the rate card, so core
     * only displays the number it is handed.
     */
    costUsd?: number | null;

    /**
     * Ordered transcript of an assistant turn — thinking, answer text, tool
     * calls, and tool results — captured from the terminal `done` chunk on a
     * live turn or rebuilt from a reopened history record. When present it is
     * rendered in place of `content`, so the bubble shows the whole turn rather
     * than only the final answer. Absent on a user turn, on a turn still
     * streaming, and on legacy records written before transcripts existed (which
     * fall back to `content`).
     */
    segments?: IAiTranscriptSegment[];

    /**
     * Tool names this send was allowed to call — the composer's per-run
     * allowlist, captured at send time. Recorded on the user turn because the
     * grant belongs to the prompt, not the answer: it drives the per-turn tool
     * chips and is what "save this prompt with its tools" persists. A turn
     * reopened from history has no value here, since the allowlist is not part
     * of the stored query record; those turns show only the tools the assistant
     * actually called, recovered from its transcript.
     */
    tools?: string[];
}
