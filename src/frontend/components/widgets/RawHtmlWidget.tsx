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
 * Localization: when the placement sets a translation key, the content is
 * rendered through the localization module's `t()` with the English
 * content as the fallback, so the block is listed on the Translations tab
 * of `/system/localization` and a translated page shows the stored
 * translation. Translations are written only by admins, like the content
 * itself, so `html` mode injects a translation raw under the same trust
 * model. No `{name}` values are passed to `t()`, so braces in the markup
 * are left as written.
 *
 * SSR + Live Updates: this is a pure presentational component whose
 * entire output derives from the SSR `data` prop — no client fetch, no
 * local state, no loading flash. The content is route-independent and
 * never changes after render, so there is no live update to subscribe to.
 * The translation lookup reads the catalog the root layout seeded into
 * `LocalizationProvider`, so the server and the browser pick the same text.
 *
 * The `'use client'` directive is mandatory despite that — not optional.
 * Every widget is rendered through `WidgetWithContext`, a client component
 * that receives the resolved component as a `Component` prop. React can
 * only serialize a *client component reference* across that server→client
 * boundary; a plain (non-`'use client'`) function is unserializable and
 * throws "Functions cannot be passed directly to Client Components",
 * crashing the SSR render of whatever zone the widget sits in (fatal for
 * the root-layout `footer` zone, which renders on every route). Marking it
 * a client component still SSRs the markup — App Router renders client
 * components on the server — so the no-flash behavior is preserved.
 *
 * @module frontend/components/widgets/RawHtmlWidget
 */

'use client';

import type { IWidgetComponentProps } from '@/types';
// Imported from the hook file rather than the localization barrel, which also
// exports components with stylesheets.
import { useTranslation } from '../../modules/localization/hooks/useTranslation';

/**
 * Prefix put in front of the operator's translation key. Mirrors
 * `RAW_HTML_TRANSLATION_KEY_PREFIX` in
 * `backend/modules/widgets/widget-types/core-widget-types.ts`, whose
 * schema help text tells operators the key is listed under this name;
 * redeclared because the frontend cannot import backend module internals.
 */
const RAW_HTML_TRANSLATION_KEY_PREFIX = 'widgets.rawHtml.';

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
    /** Operator's translation key, or null when the block is not translated. */
    translationKey?: string | null;
}

/**
 * Render an admin-authored raw text/HTML block.
 *
 * Narrows the untyped SSR `data` to the raw-html payload, swaps in the
 * stored translation when the placement names a translation key, then
 * branches on mode: `text` returns the content inside a
 * whitespace-preserving wrapper so React escapes it; `html` injects it
 * raw. Empty content renders nothing so a freshly-created placement is
 * invisible until the admin supplies markup.
 *
 * @param props - Widget component props; only the SSR `data` is consumed.
 * @returns The rendered content, or `null` when empty.
 */
export function RawHtmlWidget({ data }: IWidgetComponentProps) {
    const { content = '', mode = 'html', translationKey = null } = (data ?? {}) as IRawHtmlData;
    // Called on every render, even for untranslated blocks, because a hook
    // cannot be called conditionally.
    const { t } = useTranslation();

    // Only a keyed, non-empty block goes through t(). An empty block has no
    // English to report, and an unkeyed one, such as an embed, is meant to
    // stay the same in every language.
    const rendered = content && translationKey
        ? t(`${RAW_HTML_TRANSLATION_KEY_PREFIX}${translationKey}`, content)
        : content;

    let output = null;
    if (rendered && mode === 'text') {
        output = <div style={{ whiteSpace: 'pre-wrap' }}>{rendered}</div>;
    } else if (rendered) {
        output = <div dangerouslySetInnerHTML={{ __html: rendered }} />;
    }

    return output;
}
