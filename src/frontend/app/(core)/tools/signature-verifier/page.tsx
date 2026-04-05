/**
 * @fileoverview Signature verifier tool route.
 *
 * Thin wrapper rendering the SignatureVerifier component. No SSR data — the tool
 * is a user-driven interactive form. Supports URL query parameters for direct
 * linking: ?wallet=...&message=...&signature=...
 */

import { Suspense } from 'react';
import { SignatureVerifier } from '../../../../modules/tools';

/**
 * Wraps SignatureVerifier in Suspense because useSearchParams() requires it
 * in Next.js App Router when the page has no generateStaticParams.
 */
export default function SignatureVerifierPage() {
    return (
        <Suspense>
            <SignatureVerifier />
        </Suspense>
    );
}
