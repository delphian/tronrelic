/**
 * @file IAiConversationMessage.ts
 *
 * A single prior turn in a multi-turn AI conversation. Consumers that want
 * interactive chat (rather than one-shot queries) pass an ordered array of
 * these as {@link IAiQueryOptions.messages}; the AI Assistant seeds Claude's
 * Messages request with them ahead of the new prompt.
 */

/**
 * One completed turn of conversation history.
 *
 * Content is plain text — the resolved transcript of an earlier user prompt
 * or assistant reply. Tool-use and extended-thinking blocks are intentionally
 * not modeled here: replaying them across turns requires echoing Anthropic's
 * opaque block signatures, so prior turns carry only their visible text.
 */
export interface IAiConversationMessage {
    /** Who authored this turn. */
    role: 'user' | 'assistant';

    /** The turn's plain-text content. */
    content: string;
}
