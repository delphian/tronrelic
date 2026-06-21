/**
 * @fileoverview Tests for the content-type introspection controller: it must
 * pass the registry's list through verbatim and join each row with the live
 * curation binding resolved from the service registry.
 */

import { describe, it, expect, vi } from 'vitest';
import type { Response } from 'express';
import type { ISystemLogService } from '@/types';
import { ContentRegistry } from '../content-registry.js';
import { ContentTypesController } from '../content-types-admin.js';
import { createMockServiceRegistry } from '../../tests/vitest/mocks/service-registry.js';

/** No-op logger satisfying ISystemLogService. */
function silentLogger(): ISystemLogService {
    const noop = (): void => undefined;
    const logger = { info: noop, warn: noop, error: noop, debug: noop, trace: noop, fatal: noop, child: () => logger } as unknown as ISystemLogService;
    return logger;
}

/** A registered content type stub — only the fields the registry stores matter here. */
function stubType(typeId: string) {
    return { typeId, label: `Label ${typeId}`, describe: () => ({ title: typeId }) };
}

describe('ContentTypesController', () => {
    it('lists every registered type and joins the live curation binding', () => {
        const content = new ContentRegistry(silentLogger());
        content.register(stubType('x-poster:tweet'), 'x-poster');
        content.register(stubType('ai-tools:scheduled-prompt-run'), 'ai-tools');

        // Only the tweet type is curatable; the notification content type is not.
        const services = createMockServiceRegistry({
            curation: { hasType: (id: string) => id === 'x-poster:tweet' }
        });

        const controller = new ContentTypesController(content, services);
        const json = vi.fn();
        controller.getSnapshot({} as never, { json } as unknown as Response);

        expect(json).toHaveBeenCalledTimes(1);
        const payload = json.mock.calls[0][0] as { types: Array<{ typeId: string; providerId: string; curatable: boolean }> };
        const byId = Object.fromEntries(payload.types.map((t) => [t.typeId, t]));

        expect(payload.types).toHaveLength(2);
        expect(byId['x-poster:tweet']).toMatchObject({ providerId: 'x-poster', curatable: true });
        expect(byId['ai-tools:scheduled-prompt-run']).toMatchObject({ providerId: 'ai-tools', curatable: false });
    });

    it('reports every type as unbound when no curation service is registered', () => {
        const content = new ContentRegistry(silentLogger());
        content.register(stubType('ai-tools:scheduled-prompt-run'), 'ai-tools');

        const controller = new ContentTypesController(content, createMockServiceRegistry());
        const json = vi.fn();
        controller.getSnapshot({} as never, { json } as unknown as Response);

        const payload = json.mock.calls[0][0] as { types: Array<{ curatable: boolean }> };
        expect(payload.types[0].curatable).toBe(false);
    });
});
