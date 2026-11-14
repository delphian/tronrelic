/**
 * @fileoverview The contract for counting MCP calls in the accounting table.
 *
 * Kept as an interface so the endpoint controller and the module depend on
 * "something that counts calls" rather than on ClickHouse, which tests replace
 * with a fake and which a deployment without ClickHouse does without.
 */

import type { IToolInvocationRecord } from '@/types';
import type { IMcpCaller } from './IMcpCaller.js';

/**
 * Counts every MCP call, one accounting row each.
 */
export interface IMcpCallMeter {
    /**
     * Count a call the governor handled, from its audit record. Records from
     * any path other than MCP are ignored, so the method can be subscribed to
     * the governor's audit hook directly.
     *
     * @param record - The governor's audit record for the call.
     */
    observe(record: IToolInvocationRecord): void;

    /**
     * Count a call refused before it reached the governor, because the tool
     * was not served to the caller.
     *
     * @param caller - The admitted caller.
     * @param toolName - The tool the client asked for.
     * @param reason - Why it was not served, as the exposure service named it.
     */
    recordWithheld(caller: IMcpCaller, toolName: string, reason: string): void;
}
