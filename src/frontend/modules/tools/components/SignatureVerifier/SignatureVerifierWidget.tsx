/**
 * @fileoverview Widget renderer for the embeddable signature verifier.
 *
 * The tools module registers the verifier as the `tools:signature-verifier`
 * widget type so a CMS page can place it inside its text with a ` ```widget `
 * block. The widget registry in `widgets.core.ts` maps that id to this
 * component. The server sends no data for it, so the `data` prop is ignored.
 *
 * External sites link to the page as `?wallet=...&message=...&signature=...`,
 * and the address chip menu links with `?address=`, which counts as the
 * wallet. The widget reads those values and passes them to the form. Reading
 * the query string needs a Suspense boundary in the App Router; its fallback
 * is the same form with empty fields, so the card is in the server HTML
 * either way.
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
import { SignatureVerifierForm } from './SignatureVerifierForm';

/**
 * The verifier with its fields filled from the page link, so a verification
 * link shows its answer without the visitor copying anything.
 */
function LinkedSignatureVerifierForm() {
    const searchParams = useSearchParams();

    return (
        <SignatureVerifierForm
            initialWallet={searchParams.get('wallet') ?? searchParams.get('address') ?? ''}
            initialMessage={searchParams.get('message') ?? ''}
            initialSignature={searchParams.get('signature') ?? ''}
        />
    );
}

/**
 * Render the verifier form inside a page body, without page chrome, so the
 * surrounding CMS text supplies the heading.
 *
 * @param _props - Widget props; unused, since the widget carries no server data.
 * @returns The signature verifier form.
 */
export function SignatureVerifierWidget(_props: IWidgetComponentProps) {
    return (
        <Suspense fallback={<SignatureVerifierForm />}>
            <LinkedSignatureVerifierForm />
        </Suspense>
    );
}
