/**
 * @file IAiTool.ts
 *
 * Defines the shape of a tool that can be registered with an AI Assistant
 * service. Consuming plugins import this interface to build tools that an
 * AI model can invoke during AI-assisted queries.
 *
 * Aligns with the Anthropic tool-use specification:
 * - Tool names must match ^[a-zA-Z0-9_-]{1,64}$
 * - Input schemas follow JSON Schema with top-level type 'object'
 * - Descriptions should be detailed (see JSDoc on each field)
 */

import type { IAiToolCapability } from './IAiToolCapability.js';

/** Regex pattern for valid Anthropic tool names. */
export const AI_TOOL_NAME_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;

/**
 * JSON Schema definition for a tool's input parameters.
 *
 * Sent to the model so it knows what arguments to provide when invoking
 * the tool. Follows Anthropic's tool-use specification which requires
 * the top-level type to be 'object'.
 */
export interface IAiToolInputSchema {
    /** Must be 'object' per Anthropic tool-use spec. */
    type: 'object';
    /** Property definitions keyed by parameter name. Each value is a JSON Schema object. */
    properties: Record<string, unknown>;
    /** Parameter names that must be provided. Anthropic recommends explicit required arrays. */
    required?: string[];
    /**
     * Human-readable description of the parameters object as a whole.
     * Helps the model understand the overall shape of the expected input.
     */
    description?: string;
    /**
     * When false, signals to the model that only the declared properties are valid.
     * Anthropic recommends setting this to false to prevent the model from
     * inventing extra parameters not defined in properties.
     * @default false
     */
    additionalProperties?: boolean;
}

/**
 * A tool that can be registered with the AI Assistant for the model to invoke.
 *
 * Tools enable the model to call back into the system during a conversation,
 * execute a function, receive the result, and continue its response with
 * that context.
 *
 * **Anthropic best practices for tool definitions:**
 * - **name** — Alphanumeric with hyphens and underscores, max 64 characters.
 *   Must match `^[a-zA-Z0-9_-]{1,64}$`.
 * - **description** — Provide detailed descriptions explaining what the tool
 *   does, when it should be used, what each parameter means, and any
 *   important limitations. This is the most important factor in tool
 *   performance — the model relies on the description to decide when and
 *   how to use the tool.
 * - **inputSchema** — Define all expected parameters with types and
 *   descriptions. Set `additionalProperties: false` to prevent the model
 *   from inventing parameters. Mark truly required fields in `required`.
 *
 * @example
 * ```typescript
 * const priceTool: IAiTool = {
 *     name: 'get-energy-prices',
 *     description:
 *         'Fetches current TRON energy market prices from all providers. ' +
 *         'Use when the user asks about energy costs, rental pricing, or ' +
 *         'market comparisons. Returns an array of provider objects with ' +
 *         'price_per_unit (in SUN), duration, and provider name. ' +
 *         'Does NOT include historical prices — only current listings.',
 *     inputSchema: {
 *         type: 'object',
 *         description: 'Optional filters for the price query',
 *         properties: {
 *             duration: {
 *                 type: 'string',
 *                 description: 'Filter by rental duration (e.g., "1h", "1d", "3d"). Omit for all durations.'
 *             }
 *         },
 *         required: [],
 *         additionalProperties: false
 *     },
 *     handler: async (input) => {
 *         return await marketService.getPrices(input.duration as string);
 *     }
 * };
 * ```
 */
export interface IAiTool {
    /**
     * Unique tool name. Must match `^[a-zA-Z0-9_-]{1,64}$`.
     * Alphanumeric characters, hyphens, and underscores only.
     */
    name: string;
    /**
     * Detailed description shown to the model. This is the most important factor
     * in tool performance. Explain what the tool does, when to use it,
     * what each parameter means, and any limitations or requirements.
     */
    description: string;
    /** JSON Schema defining the tool's expected input parameters. */
    inputSchema: IAiToolInputSchema;
    /**
     * Governance classification — the tool's side effect, reversibility, spend,
     * data sensitivity, and approval requirement. The governor derives the
     * guardrails (rate limit, quota, cost cap, approval, audit redaction) from
     * this. Optional for back-compat; when absent the governor treats the tool
     * as read/internal and warns at startup. See {@link IAiToolCapability}.
     */
    capability?: IAiToolCapability;
    /** Async handler executed server-side when the model invokes this tool. */
    handler: (input: Record<string, unknown>) => Promise<unknown>;
}
