/**
 * Model metadata combining Anthropic Models API data with static token limits.
 *
 * The API provides id, display_name, and created_at. Token limits are
 * merged from a static lookup since the Models API does not expose them.
 */
export interface IModelInfo {
    /** Model identifier (e.g., 'claude-sonnet-4-5-20250514'). */
    id: string;
    /** Human-readable model name. */
    display_name: string;
    /** Maximum output tokens the model can generate per request. */
    max_tokens?: number;
    /** Maximum input context window in tokens. */
    input_token_limit?: number;
    /** ISO timestamp of when the model was created. */
    created_at?: string;
}
