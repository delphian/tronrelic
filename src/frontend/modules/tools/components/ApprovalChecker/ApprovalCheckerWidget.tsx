/**
 * @fileoverview Widget renderer for the embeddable token approval checker.
 *
 * The tools module registers the checker as the `tools:approval-checker`
 * widget type so a CMS page can place it inside its text with a ` ```widget `
 * block. The widget registry in `widgets.core.ts` maps that id to this
 * component. The server sends no data for it, so the `data` prop is ignored;
 * the form decides from the session whether to show itself or a sign-in note.
 *
 * The address chip menu links to the checker with an `?address=` value, so
 * the widget reads it and passes it to the form. Reading the query string
 * needs a Suspense boundary in the App Router; its fallback is the same form
 * with an empty field, so the card is in the server HTML either way.
 *
 * The file is a client module, as every widget component must be: a CMS
 * page renders its embeds on the server and hands each widget's component to
 * the client-side `WidgetWithContext`, and React can pass a component across
 * that boundary only when its module is marked `'use client'`.
 */
'use client';

import { Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import type { IWidgetComponentProps } from '@/types';
import { ApprovalCheckerForm } from './ApprovalCheckerForm';

/**
 * The checker with its field filled from the page link's `?address=` value,
 * so a visitor arriving from an address chip does not choose the address again.
 */
function ForwardedApprovalCheckerForm() {
    const searchParams = useSearchParams();

    return <ApprovalCheckerForm initialAddress={searchParams.get('address') ?? ''} />;
}

/**
 * Render the checker inside a page body, without page chrome, so the
 * surrounding CMS text supplies the heading.
 *
 * @param _props - Widget props; unused, since the widget carries no server data.
 * @returns The token approval checker.
 */
export function ApprovalCheckerWidget(_props: IWidgetComponentProps) {
    return (
        <Suspense fallback={<ApprovalCheckerForm />}>
            <ForwardedApprovalCheckerForm />
        </Suspense>
    );
}
