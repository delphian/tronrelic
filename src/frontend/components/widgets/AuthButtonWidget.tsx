/**
 * @fileoverview Core "sign-in button" widget renderer.
 *
 * Renders the `core:auth-button` widget type: the site's sign-in button for
 * signed-out visitors, and a short identity pill linking to `/profile` for
 * signed-in ones, where wallet management and sign-out live. It used to be
 * fixed inside the site header; as a widget an operator places it from
 * `/system/widgets`, in any zone and next to any other widget.
 *
 * The button itself is `WalletButton` from the user module, unchanged. This
 * component only passes it the administrator's sign-in image from the SSR
 * `data` prop.
 *
 * SSR + Live Updates: the image arrives in the server-rendered payload, and
 * the signed-in state comes from the session the root layout resolved and
 * seeded into `SessionProvider`, so the server renders the right button and
 * the first client render matches it. Signing in or out updates the session
 * context, which re-renders the button with no refetch.
 *
 * The `'use client'` directive is required even though this file calls no
 * hooks: every widget is handed to the client component `WidgetWithContext`
 * as a prop, and only a client component reference can cross that boundary
 * (see `RawHtmlWidget.tsx`). It is still rendered on the server.
 *
 * @module frontend/components/widgets/AuthButtonWidget
 */

'use client';

import type { IWidgetComponentProps } from '@/types';
import { WalletButton } from '../../modules/user';

/**
 * SSR payload shape produced by the `core:auth-button` data fetcher.
 * Mirrors `IAuthButtonWidgetData` in
 * `backend/modules/widgets/widget-types/core-widget-types.ts`; redeclared
 * here because the frontend cannot import backend module internals.
 */
interface IAuthButtonData {
    /** Administrator-chosen image for the button, or null for the text button. */
    imageUrl?: string | null;
}

/**
 * Sign-in / profile button widget.
 *
 * @param props - Widget component props; only the SSR `data` is read, since
 *   the button needs no route, params, or plugin context.
 * @returns The auth button, shown as the administrator's image when one is set.
 */
export function AuthButtonWidget({ data }: IWidgetComponentProps) {
    const { imageUrl = null } = (data ?? {}) as IAuthButtonData;

    return <WalletButton imageUrl={imageUrl} />;
}
