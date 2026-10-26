/**
 * @fileoverview Operator heading drawn above a placed widget.
 *
 * An operator can give any placement a heading, and optionally a link, on
 * `/system/widgets`. Those are stored strings, so without help they render in
 * English on every page and the link drops a visitor on a translated page back
 * into English. This component renders the heading through the localization
 * module's `t()` and the link through `useLocalizedHref`, so both follow the
 * page's language.
 *
 * The translation key is derived from the placement id as
 * `widgets.placement.<placementId>.title` in the `core` namespace, so the
 * operator does not have to choose one. The key appears on the Translations
 * tab of `/system/localization` once a page showing the heading has rendered.
 * A placement that is deleted and created again gets a new id, and therefore
 * a new key, so its old translation is not carried over.
 *
 * `WidgetZone` is a server component and cannot call hooks, which is why the
 * heading lives in its own client component. App Router still renders it on
 * the server, and the lookup reads the catalog the root layout seeded into
 * `LocalizationProvider`, so the server and the browser render the same text.
 *
 * @module frontend/components/widgets/WidgetTitle
 */

'use client';

import Link from 'next/link';
// Imported from the hook files rather than the localization barrel, which also
// exports components with stylesheets.
import { useTranslation } from '../../modules/localization/hooks/useTranslation';
import { useLocalizedHref } from '../../modules/localization/hooks/useLocalizedHref';

/**
 * Prefix of every placement heading's translation key. Groups the headings
 * together on the Translations tab, next to the `widgets.rawHtml.` blocks.
 */
const PLACEMENT_TITLE_TRANSLATION_KEY_PREFIX = 'widgets.placement.';

/**
 * Props for the WidgetTitle component.
 */
interface IWidgetTitleProps {
    /** The operator's English heading text. */
    title: string;
    /** Root-relative link for the heading, or undefined for a plain heading. */
    titleUrl?: string;
    /**
     * The placement's validated id. Without one the heading has no stable key,
     * so it renders untranslated rather than under a key shared by others.
     */
    placementId?: string;
    /** Scoped classes `WidgetZone` computes for the heading size. */
    className: string;
}

/**
 * Render a placement's heading in the page's language.
 *
 * Looks up the translation keyed by the placement id, with the English heading
 * as the fallback, and localizes the link so a visitor stays in their language
 * when the target page is published in it. On English pages both calls return
 * their input unchanged.
 *
 * @param props - The heading text, optional link, placement id, and classes.
 * @returns The heading element, linked when the placement has a URL.
 */
export function WidgetTitle({ title, titleUrl, placementId, className }: IWidgetTitleProps) {
    // Both hooks run on every render, because a hook cannot be called
    // conditionally.
    const { t } = useTranslation();
    const localize = useLocalizedHref();

    const text = placementId
        ? t(`${PLACEMENT_TITLE_TRANSLATION_KEY_PREFIX}${placementId}.title`, title)
        : title;

    return (
        <h2 className={className}>
            {/* The bare `a` rule in globals.scss is deliberately neutral —
                inherited color, no underline — so a linked heading would
                otherwise look identical to a plain one and offer nothing to
                click on until the pointer is already over it. `link` is the
                site's global utility class for text that has to read as a
                link, so apply it here rather than adding an anchor rule to
                this module and inventing a second treatment. */}
            {titleUrl ? (
                <Link href={localize(titleUrl)} className="link">{text}</Link>
            ) : (
                text
            )}
        </h2>
    );
}
