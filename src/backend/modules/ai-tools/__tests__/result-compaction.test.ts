/**
 * @file result-compaction.test.ts
 *
 * Contract tests for the two layers that keep AI tool results inside the model's
 * context window. The behaviour worth pinning is not the arithmetic — it is the
 * scoping. The capability predicate is the entire safety argument for compaction,
 * and a change that widened it would silently start routing secret payloads
 * through a second model and rewording figures the platform computed itself, with
 * no test failing to say so. Each case below therefore states which class it
 * stands for.
 *
 * The provider is a stub, so the model-extraction tier is exercised without a
 * live API key or a network call.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IAiProvider, IAiToolCapability } from '@/types';
import {
    MAX_TOOL_RESULT_CHARS,
    capToolResult,
    isCompactable,
    createToolResultCompactor
} from '../result-compaction.js';

/** The capability `tronrelic-fetch-url` declares — the one shape compaction is meant for. */
const PUBLIC_UNTRUSTED: IAiToolCapability = {
    sideEffect: 'external',
    reversible: true,
    sensitivity: 'public',
    surfacesUntrustedContent: true
};

/**
 * Build a stub provider that records the options it was queried with, so a test
 * can assert the extraction call is made tool-less rather than merely made.
 *
 * @param responseText - What the stub model answers with.
 * @returns The stub provider and the spy standing in for its `query` method.
 */
function stubProvider(responseText: string): { provider: IAiProvider; query: ReturnType<typeof vi.fn> } {
    const query = vi.fn().mockResolvedValue({ responseText, model: 'stub', usage: { inputTokens: 0, outputTokens: 0 } });
    return { provider: { query } as unknown as IAiProvider, query };
}

/**
 * Build the handler under test with a stub provider and a silent log sink.
 *
 * @param provider - Provider the extraction tier should resolve, or null for none.
 * @returns The `ai.toolResult` handler.
 */
function buildCompactor(provider: IAiProvider | null) {
    return createToolResultCompactor({ getProvider: () => provider, log: () => undefined });
}

/**
 * Invoke the handler for a tool of the given capability.
 *
 * @param capability - The declared capability of the calling tool.
 * @param value - The raw tool result.
 * @param provider - Provider available to the extraction tier.
 * @param input - Tool arguments, carrying `extract` where a test needs it.
 * @param aiProviderId - Id of the provider driving the invocation, when a test cares which one is resolved.
 * @returns Whatever the handler decided to forward.
 */
async function compact(
    capability: IAiToolCapability | undefined,
    value: unknown,
    provider: IAiProvider | null = null,
    input: Record<string, unknown> = {},
    aiProviderId?: string
): Promise<unknown> {
    return buildCompactor(provider)(
        { toolName: 'tronrelic-fetch-url', capability, input, context: { aiProviderId } },
        value
    );
}

describe('capToolResult', () => {
    it('leaves a result under the ceiling untouched, so the common case is not reshaped', () => {
        const value = { ok: true, rows: [1, 2, 3] };
        expect(capToolResult(value, 'any-tool')).toEqual({ value, capped: false });
    });

    it('truncates an over-long string in place and tells the model to narrow the request', () => {
        const result = capToolResult('x'.repeat(MAX_TOOL_RESULT_CHARS + 100), 'any-tool');
        expect(result.capped).toBe(true);
        expect(typeof result.value).toBe('string');
        expect(result.value as string).toContain('[truncated:');
        expect(result.value as string).toContain('Narrow the request');
    });

    it('keeps the finished payload inside the ceiling, note and JSON escaping included', () => {
        // The defect this pins: slicing to the limit and *then* adding the note
        // and the JSON envelope measured neither, so an all-quotes payload came
        // back at twice the ceiling once every `"` was re-escaped on the way out.
        const quoted = '"'.repeat(MAX_TOOL_RESULT_CHARS + 1_000);
        for (const oversized of [quoted, { body: quoted }]) {
            const result = capToolResult(oversized, 'tronrelic-fetch-url');
            expect(result.capped).toBe(true);
            expect(JSON.stringify(result.value)?.length).toBeLessThanOrEqual(MAX_TOOL_RESULT_CHARS);
        }
    });

    it('replaces an oversized object with a marker rather than slicing its JSON mid-structure', () => {
        const oversized = { rows: Array.from({ length: 20_000 }, (_, index) => ({ index, note: 'x'.repeat(20) })) };
        const result = capToolResult(oversized, 'any-tool');
        expect(result.capped).toBe(true);
        expect(result.value).toMatchObject({ truncated: true });
        expect(typeof (result.value as { preview: unknown }).preview).toBe('string');
    });
});

describe('isCompactable', () => {
    it('admits a public, untrusted-content tool — the class fetched web text belongs to', () => {
        expect(isCompactable(PUBLIC_UNTRUSTED)).toBe(true);
    });

    it('refuses a secret reader, so a log or file payload is never sent to a second model', () => {
        expect(isCompactable({ sideEffect: 'read', reversible: true, sensitivity: 'secret', surfacesUntrustedContent: true })).toBe(false);
    });

    it('refuses an internal tool, so a computed figure is never reworded', () => {
        expect(isCompactable({ sideEffect: 'read', reversible: true, sensitivity: 'internal', surfacesUntrustedContent: true })).toBe(false);
    });

    it('refuses a public tool that does not surface untrusted content, so a returned id survives exactly', () => {
        expect(isCompactable({ sideEffect: 'read', reversible: true, sensitivity: 'public', surfacesUntrustedContent: false })).toBe(false);
    });
});

describe('createToolResultCompactor', () => {
    it('passes a small result straight through, so most calls cost nothing', async () => {
        const value = { content: '{"a":1}' };
        expect(await compact(PUBLIC_UNTRUSTED, value)).toBe(value);
    });

    it('passes an oversized result through untouched when the tool is out of scope', async () => {
        const value = { content: JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ i, body: 'y'.repeat(200) }))) };
        const secret: IAiToolCapability = { sideEffect: 'read', reversible: true, sensitivity: 'secret', surfacesUntrustedContent: true };
        expect(await compact(secret, value)).toBe(value);
    });

    it('passes an oversized result through when the capability is unknown, failing closed', async () => {
        // The governor threads no capability when it could not resolve the call to
        // a registered tool. Nothing then says the result is safe to shrink, so it
        // must be left for the hard cap rather than compacted on a guess.
        const value = { content: JSON.stringify(Array.from({ length: 500 }, (_, i) => ({ i, body: 'y'.repeat(200) }))) };
        expect(await compact(undefined, value)).toBe(value);
    });

    it('shrinks a long JSON list without a model call, keeping the values it shows exact', async () => {
        const rows = Array.from({ length: 500 }, (_, index) => ({ id: index, body: 'y'.repeat(400) }));
        const { provider, query } = stubProvider('unused');
        const result = await compact(PUBLIC_UNTRUSTED, { content: JSON.stringify(rows), status: 200 }, provider);

        const content = (result as { content: { items: { id: number }[]; itemsTotal: number } }).content;
        expect(query).not.toHaveBeenCalled();
        expect(content.itemsTotal).toBe(500);
        expect(content.items.length).toBeLessThan(500);
        // The values that survive are the originals, not a paraphrase — this is
        // the property that makes the deterministic tier preferable.
        expect(content.items[0].id).toBe(0);
        // Envelope fields the model cites are preserved alongside the shrunk body.
        expect((result as { status: number }).status).toBe(200);
    });

    it('extracts with the model only when the payload has no structure to shrink, and passes no tools', async () => {
        const { provider, query } = stubProvider('The release is v4.8.0 and the upgrade is mandatory.');
        const html = `<html><body>${'<p>filler</p>'.repeat(3000)}</body></html>`;
        const value = { content: html, finalUrl: 'https://example.com/final', status: 200 };
        const result = await compact(PUBLIC_UNTRUSTED, value, provider, { extract: 'the release tag' });

        expect(query).toHaveBeenCalledTimes(1);
        expect(query.mock.calls[0][0]).toMatchObject({ toolAllowlist: [] });
        expect(query.mock.calls[0][0].prompt).toContain('the release tag');
        expect(result).toMatchObject({
            compacted: true,
            extracted: true,
            content: 'The release is v4.8.0 and the upgrade is mandatory.'
        });
        // The envelope has to survive: the fetch tool tells the model to cite
        // finalUrl, and after a redirect that address exists nowhere else.
        expect(result).toMatchObject({ finalUrl: 'https://example.com/final', status: 200 });
    });

    it('skips model extraction when the provider hosts its own tools, since the call would not be tool-free', async () => {
        // `toolAllowlist: []` disables governed registry tools only — a vendor's
        // own web_search/web_fetch stay advertised and bypass the governor. Running
        // attacker-controlled text through a call that still carries them would
        // hand an injection the outbound reach this seam exists to deny.
        const query = vi.fn().mockResolvedValue({ responseText: 'should never be produced', model: 'stub', usage: { inputTokens: 0, outputTokens: 0 } });
        const provider = {
            query,
            listActiveServerTools: vi.fn().mockResolvedValue([{ name: 'web_search' }])
        } as unknown as IAiProvider;
        const value = { content: `<html>${'<p>filler</p>'.repeat(3000)}</html>` };

        expect(await compact(PUBLIC_UNTRUSTED, value, provider)).toBe(value);
        expect(query).not.toHaveBeenCalled();
    });

    it('resolves the provider that owns the invocation, not whichever one is globally active', async () => {
        // A saved prompt can pin a provider that is not the active one, and its
        // tool calls execute under that pinned provider. Extracting through the
        // active provider instead would send the fetched page and the cost to a
        // vendor this run never chose.
        const { provider } = stubProvider('extracted text');
        const getProvider = vi.fn().mockReturnValue(provider);
        const handler = createToolResultCompactor({ getProvider, log: () => undefined });
        const value = { content: `<html>${'<p>filler</p>'.repeat(3000)}</html>` };

        await handler(
            { toolName: 'tronrelic-fetch-url', capability: PUBLIC_UNTRUSTED, input: {}, context: { aiProviderId: 'pinned-provider' } },
            value
        );

        expect(getProvider).toHaveBeenCalledWith('pinned-provider');
    });

    it('returns the original when no provider is installed, leaving the hard cap to bound it', async () => {
        const value = { content: `<html>${'<p>filler</p>'.repeat(3000)}</html>` };
        expect(await compact(PUBLIC_UNTRUSTED, value, null)).toBe(value);
    });

    it('returns the original when the extraction call throws, so failing to compact never fails the tool call', async () => {
        const provider = { query: vi.fn().mockRejectedValue(new Error('no api key')) } as unknown as IAiProvider;
        const value = { content: `<html>${'<p>filler</p>'.repeat(3000)}</html>` };
        expect(await compact(PUBLIC_UNTRUSTED, value, provider)).toBe(value);
    });
});
