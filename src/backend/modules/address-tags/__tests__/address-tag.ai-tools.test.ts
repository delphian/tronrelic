/**
 * Unit tests for the address-tags AI tools.
 *
 * They pin what the tools promise a model: addresses are checksum-verified
 * before any lookup, only live tags and live source citations are returned,
 * results are capped with an honest `truncated`, and a bad argument comes back
 * as an input error the model can correct from rather than as a failure.
 */
import { describe, it, expect, vi } from 'vitest';
import type { IAddressTag, IAddressTagService, ISystemLogService } from '@/types';
import { AI_TOOL_NAMES, buildAddressTagAiTools } from '../ai-tools.js';

/** Real, checksum-valid addresses, so the tools' own validation accepts them. */
const WALLET = 'TXFBqBbqJommqZf7BV8NNYzePh97UmJodJ';
const PEER = 'TAUN6FwrnwwmaEqYcckffC7wYmbaS6cBiX';

/**
 * A stored assignment with sensible defaults.
 *
 * @param overrides - Fields that differ from a live manual tag on WALLET.
 * @returns The record.
 */
function tagRecord(overrides: Partial<IAddressTag> = {}): IAddressTag {
    return {
        address: WALLET,
        tag: 'exchange',
        createdAt: new Date('2026-09-01T00:00:00Z'),
        updatedAt: new Date('2026-09-01T00:00:00Z'),
        manual: true,
        active: true,
        sources: [],
        ...overrides
    };
}

/**
 * Build the tools over a fake service.
 *
 * @param service - The fake service methods the test needs.
 * @returns The tools keyed by name.
 */
function buildTools(service: Partial<IAddressTagService>): Record<string, ReturnType<typeof buildAddressTagAiTools>[number]> {
    const logger = { error: vi.fn(), info: vi.fn(), warn: vi.fn() } as unknown as ISystemLogService;
    const tools = buildAddressTagAiTools(service as IAddressTagService, logger);
    return Object.fromEntries(tools.map(tool => [tool.name, tool]));
}

describe('address tag AI tools', () => {
    it('are named after the module and classified as reads', () => {
        const tools = buildTools({});

        expect(Object.keys(tools).sort()).toEqual(Object.values(AI_TOOL_NAMES).sort());
        for (const tool of Object.values(tools)) {
            expect(tool.name.startsWith('address-tags-')).toBe(true);
            expect(tool.capability).toEqual(expect.objectContaining({ sideEffect: 'read', reversible: true }));
        }
    });

    it('returns live tags with live citations only, and an empty list for an untagged address', async () => {
        const getTagsByAddresses = vi.fn(async () => [
            tagRecord({
                tag: 'ofac:sdn',
                manual: false,
                sources: [
                    { id: 'ofac-sdn', ref: '12345', url: 'https://example.test/sdn', observedAt: new Date('2026-09-20T06:00:00Z') },
                    { id: 'chainalysis', observedAt: new Date('2026-09-01T00:00:00Z'), withdrawnAt: new Date('2026-09-10T00:00:00Z') }
                ]
            }),
            tagRecord({ tag: 'stale', active: false })
        ]);
        const tool = buildTools({ getTagsByAddresses })[AI_TOOL_NAMES.getTags];

        const result = await tool.handler({ addresses: [WALLET, PEER] }) as Record<string, unknown>;

        expect(getTagsByAddresses).toHaveBeenCalledWith([WALLET, PEER]);
        expect(result.addresses).toEqual([
            {
                address: WALLET,
                tags: [{
                    tag: 'ofac:sdn',
                    manual: false,
                    sources: [{ source: 'ofac-sdn', ref: '12345', url: 'https://example.test/sdn', observedAt: '2026-09-20T06:00:00.000Z' }]
                }]
            },
            { address: PEER, tags: [] }
        ]);
    });

    it('refuses an address whose checksum is wrong, without looking anything up', async () => {
        const getTagsByAddresses = vi.fn();
        const tool = buildTools({ getTagsByAddresses })[AI_TOOL_NAMES.getTags];

        const result = await tool.handler({ addresses: ['TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6u'] }) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: false, errorKind: 'input' }));
        expect(getTagsByAddresses).not.toHaveBeenCalled();
    });

    it('groups addresses found by tag and reports truncation past the limit', async () => {
        const getAddressesByTags = vi.fn(async () => [
            tagRecord({ address: PEER, tag: 'usdt:frozen', manual: false, sources: [{ id: 'usdt-blacklist', observedAt: new Date('2026-09-20T00:00:00Z') }] }),
            tagRecord({ address: WALLET, tag: 'usdt:frozen' }),
            tagRecord({ address: WALLET, tag: 'ofac:sdn' })
        ]);
        const tool = buildTools({ getAddressesByTags })[AI_TOOL_NAMES.findByTag];

        const result = await tool.handler({ tags: ['usdt:frozen', 'ofac:sdn'], limit: 1 }) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: true, totalAddresses: 2, returned: 1, truncated: true }));
        expect(result.addresses).toEqual([expect.objectContaining({ address: PEER })]);
    });

    it('asks for one more tag than requested so truncation is known', async () => {
        const listTags = vi.fn(async () => ['token:usdc', 'token:usdt', 'token:wtrx']);
        const tool = buildTools({ listTags })[AI_TOOL_NAMES.listTags];

        const result = await tool.handler({ prefix: 'token:', limit: 2 }) as Record<string, unknown>;

        expect(listTags).toHaveBeenCalledWith({ prefix: 'token:', limit: 3 });
        expect(result).toEqual(expect.objectContaining({ returned: 2, truncated: true, tags: ['token:usdc', 'token:usdt'] }));
    });

    it('reports a service failure without its details', async () => {
        const listTags = vi.fn(async () => {
            throw new Error('connection refused to mongodb://internal:27017');
        });
        const tool = buildTools({ listTags })[AI_TOOL_NAMES.listTags];

        const result = await tool.handler({}) as Record<string, unknown>;

        expect(result).toEqual(expect.objectContaining({ success: false, errorKind: 'failed' }));
        expect(String(result.error)).not.toContain('mongodb');
    });
});
