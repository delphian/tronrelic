/**
 * @fileoverview Core "sign-in button" widget renderer.
 *
 * Renders the `core:auth-button` widget type: the site's sign-in button for
 * signed-out visitors, and a short identity pill linking to `/profile` for
 * signed-in ones, where wallet management and sign-out live. It used to be
 * fixed inside the site header; as a widget an operator places it from
 * `/system/widgets`, in any zone and next to any other widget.
 *
 * The button and its slide-out tray of links are `AccountTray` from the user
 * module. This component only passes it the administrator's sign-in image and
 * the placement's tray settings from the SSR `data` prop.
 *
 * SSR + Live Updates: the image and tray settings arrive in the
 * server-rendered payload, and the signed-in state comes from the session the
 * root layout resolved and seeded into `SessionProvider`, so the server
 * renders the right button and the first client render matches it. Signing in
 * or out updates the session context, which re-renders the button, and the
 * set of links the visitor sees, with no refetch.
 *
 * The `'use client'` directive is required even though this file calls no
 * hooks: every widget is handed to the client component `WidgetWithContext`
 * as a prop, and only a client component reference can cross that boundary
 * (see `RawHtmlWidget.tsx`). It is still rendered on the server.
 *
 * @module frontend/components/widgets/AuthButtonWidget
 */

'use client';

import type { IAuthButtonLink, IWidgetComponentProps } from '@/types';
import { AccountTray } from '../../modules/user';

/**
 * SSR payload shape produced by the `core:auth-button` data fetcher.
 * Mirrors `IAuthButtonWidgetData` in
 * `backend/modules/widgets/widget-types/core-widget-types.ts`; redeclared
 * here because the frontend cannot import backend module internals. Every
 * field is optional because a payload cached before the tray existed has
 * only `imageUrl`.
 */
interface IAuthButtonData {
    /** Administrator-chosen image for the button, or null for the text button. */
    imageUrl?: string | null;
    /** Links shown in the slide-out tray. */
    links?: IAuthButtonLink[];
    /** Which way the tray slides out of the button. */
    direction?: 'right' | 'down';
    /** Opacity of the tray's background as a percentage. */
    opacity?: number;
}

/**
 * Sign-in / profile button widget.
 *
 * @param props - Widget component props; only the SSR `data` is read, since
 *   the button needs no route, params, or plugin context.
 * @returns The auth button, shown as the administrator's image when one is
 *   set, with its tray of links when the placement configures any.
 */
export function AuthButtonWidget({ data }: IWidgetComponentProps) {
    const { imageUrl = null, links = [], direction = 'right', opacity = 85 } = (data ?? {}) as IAuthButtonData;

    return <AccountTray imageUrl={imageUrl} links={links} direction={direction} opacity={opacity} />;
}
