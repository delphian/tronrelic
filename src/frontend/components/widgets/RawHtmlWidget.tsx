/**
 * @fileoverview Core "raw text / HTML" widget renderer.
 *
 * Renders the operator-authored content carried by the `core:raw-html`
 * widget type so admins can drop arbitrary markup (footer links, legal
 * text, attribution, embeds) into any zone without shipping a plugin.
 *
 * Trust model: the content originates from a `requireAdmin`-gated
 * placement config and is validated against the type's JSON Schema at
 * write time. Admins already wield equivalent power (head-fragment
 * injection, themes, pages markdown), so `html` mode injects the markup
 * verbatim via `dangerouslySetInnerHTML` — that raw passthrough is the
 * feature, not an oversight. `text` mode escapes the content (React's
 * default text handling) and preserves author line breaks for safe
 * plain-text blocks.
 *
 * SSR + Live Updates: this is a pure presentational component whose
 * entire output derives from the SSR `data` prop — no client fetch, no
 * local state, no loading flash — so it renders fully on the server and
 * needs no `'use client'` directive or hydration guard. The content is
 * route-independent and never changes after render, so there is no live
 * update to subscribe to.
 *
 * @module frontend/components/widgets/RawHtmlWidget
 */

import type { IWidgetComponentProps } from '@/types';

/**
 * SSR payload shape produced by the `core:raw-html` backend data
 * fetcher. Mirrors `IRawHtmlWidgetData` in
 * `backend/modules/widgets/widget-types/core-widget-types.ts`; redeclared
 * locally because the frontend cannot import backend module internals.
 */
interface IRawHtmlData {
    /** Operator-authored raw HTML or plain text. */
    content?: string;
    /** Render mode: `html` injects markup, `text` escapes it. */
    mode?: 'html' | 'text';
}

/**
 * Render an admin-authored raw text/HTML block.
 *
 * Narrows the untyped SSR `data` to the raw-html payload, then branches
 * on mode: `text` returns the content inside a whitespace-preserving
 * wrapper so React escapes it; `html` injects it raw. Empty content
 * renders nothing so a freshly-created placement is invisible until the
 * admin supplies markup.
 *
 * @param props - Widget component props; only the SSR `data` is consumed.
 * @returns The rendered content, or `null` when empty.
 */
export function RawHtmlWidget({ data }: IWidgetComponentProps) {
    const { content = '', mode = 'html' } = (data ?? {}) as IRawHtmlData;

    if (!content) {
        return null;
    }

    if (mode === 'text') {
        return <div style={{ whiteSpace: 'pre-wrap' }}>{content}</div>;
    }

    return <div dangerouslySetInnerHTML={{ __html: content }} />;
}
