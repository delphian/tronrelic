/**
 * @file toast-channel.test.ts
 *
 * Covers the toast channel's fidelity refusal, added for the content-router
 * migration: under the router's floor match a toast can be handed content it
 * cannot render, so with neither a title nor a body it refuses (delivered 0,
 * refused true) without emitting, while content carrying renderable text still
 * emits and reports its delivered count.
 */

import { describe, it, expect, vi } from 'vitest';
import type { IRenderedNotification, IContentDescriptor } from '@/types';
import { ToastChannel } from '../channels/toast-channel.js';

/** Wrap a content descriptor in the rendered-notification envelope deliver expects. */
function rendered(content: IContentDescriptor): IRenderedNotification {
    return {
        id: 'a1',
        categoryId: 'c',
        categoryLabel: 'Cat',
        severity: 'info',
        content,
        createdAt: new Date(0)
    };
}

describe('ToastChannel fidelity refusal', () => {
    it('refuses content with neither title nor body, without emitting', async () => {
        const emit = vi.fn();
        const toast = new ToastChannel({ emit });

        const result = await toast.deliver([{ userId: 'u1' }], rendered({}));

        expect(result).toEqual({ delivered: 0, refused: true });
        expect(emit).not.toHaveBeenCalled();
    });

    it('delivers when a body is present, reporting the recipient count', async () => {
        const emit = vi.fn();
        const toast = new ToastChannel({ emit });

        const result = await toast.deliver([{ userId: 'u1' }, { userId: 'u2' }], rendered({ body: 'hello' }));

        expect(result).toEqual({ delivered: 2 });
        expect(emit).toHaveBeenCalledOnce();
    });
});
