/**
 * @fileoverview Tests for what the governor writes into the audit record: every
 * tool's arguments kept in full with credentials scrubbed, a result preview
 * scrubbed before it is cut, and the full result length recorded beside it.
 *
 * These guard the rule that replaced blanking a `secret` tool's arguments,
 * which hid the request an admin needed while keeping the result unredacted.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAiTool, IAiToolCapability, IToolInvocationContext, IToolInvocationRecord } from '@/types';
import { createMockDatabaseService } from '../../../tests/vitest/mocks/database-service.js';
import { AiToolGovernor } from '../services/ai-tool-governor.js';
import { ToolPolicyEngine } from '../services/tool-policy-engine.js';
import { WindowedLogLimiter } from '../../../lib/WindowedLogLimiter.js';
import { REDACTION_MARKER, SecretScrubber } from '../../../lib/SecretScrubber.js';

/** A silent logger. */
const logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn(), child: vi.fn() } as any;

/** A deployment secret long enough for the exact-value pass to match. */
const DEPLOYMENT_SECRET = 'deployment-admin-token-0123456789';

/** A read-only tool classed secret, like `identity-get-account`. */
const SECRET_READ: IAiToolCapability = { sideEffect: 'read', reversible: true, sensitivity: 'secret' };

/** An admin running a query from the Query tab. */
const ADMIN_CONTEXT: IToolInvocationContext = { actor: { kind: 'admin', id: 'admin-1' }, triggerPath: 'interactive', aiProviderId: 'test-provider' };

/**
 * Build a governor over one tool and return the record it writes for a call.
 *
 * @param handler - What the tool returns.
 * @param input - The arguments to call it with.
 * @returns The audit record written for the call.
 */
async function recordFor(handler: IAiTool['handler'], input: Record<string, unknown>): Promise<IToolInvocationRecord> {
    const tool: IAiTool = {
        name: 'identity-get-account',
        description: 'Get one account.',
        inputSchema: { type: 'object', properties: { userId: { type: 'string' }, apiKey: { type: 'string' } }, additionalProperties: false },
        capability: SECRET_READ,
        handler
    };
    const registry = { getTool: () => tool, listToolInfo: () => [], getEnabledTools: () => [tool] } as any;
    const audit = { record: vi.fn(async () => undefined) } as any;
    const hookRegistry = { invoke: vi.fn(async (_descriptor: unknown, _input: unknown, seed?: unknown) => seed) } as any;
    const governor = new AiToolGovernor(
        logger,
        registry,
        new ToolPolicyEngine(logger, createMockDatabaseService()),
        audit,
        { enqueue: vi.fn() } as any,
        hookRegistry,
        new WindowedLogLimiter({ windowMs: 60_000, maxKeys: 10, maxKeyLength: 300 }),
        new SecretScrubber([DEPLOYMENT_SECRET])
    );
    await governor.invoke(tool.name, input, ADMIN_CONTEXT);
    return audit.record.mock.calls[0][0] as IToolInvocationRecord;
}

describe('the audit record the governor writes', () => {
    it('keeps a secret tool\'s arguments, replacing only the credential among them', async () => {
        const record = await recordFor(vi.fn(async () => ({ found: false })), { userId: '6a1814fad4b59f31f1d9c828', apiKey: 'anything' });
        expect(record.input).toEqual({ userId: '6a1814fad4b59f31f1d9c828', apiKey: REDACTION_MARKER });
    });

    it('scrubs a deployment secret out of the result preview', async () => {
        const record = await recordFor(vi.fn(async () => ({ note: `token is ${DEPLOYMENT_SECRET}` })), { userId: 'u' });
        expect(record.resultDigest).toBe(JSON.stringify({ note: `token is ${REDACTION_MARKER}` }));
    });

    it('scrubs a secret-named field before the preview is cut, so the cut cannot split it from its key', async () => {
        const padding = 'x'.repeat(490);
        const record = await recordFor(vi.fn(async () => ({ padding, password: 'hunter2-hunter2-hunter2' })), { userId: 'u' });
        expect(record.resultDigest).not.toContain('hunter2');
    });

    it('records the full result length beside a preview cut to 500 characters', async () => {
        const result = { text: 'y'.repeat(2_000) };
        const record = await recordFor(vi.fn(async () => result), { userId: 'u' });
        expect(record.resultChars).toBe(JSON.stringify(result).length);
        expect(record.resultDigest?.endsWith('…')).toBe(true);
        expect(record.resultDigest).toHaveLength(501);
    });

    it('scrubs a credential quoted in a handler\'s error', async () => {
        const record = await recordFor(vi.fn(async () => { throw new Error('connect failed: mongodb://admin:s3cretpass@db:27017'); }), { userId: 'u' });
        expect(record.status).toBe('error');
        expect(record.error).not.toContain('s3cretpass');
    });
});
