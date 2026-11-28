/**
 * @fileoverview Widget renderer for the embeddable Address Origins tracer.
 *
 * The tools module registers the tracer as the `tools:address-origins` widget
 * type so a CMS page can place it inside its text with a ` ```widget ` block.
 * The widget registry in `widgets.core.ts` maps that id to this component.
 * The server sends no data for it, so the `data` prop is ignored.
 *
 * - The registry is loaded with the site layout, so anything this file
 *   imports statically is downloaded on every page. The tracer is the largest
 *   tool, with its own panel, chain, and rung components and a streaming
 *   hook, so it is loaded through `next/dynamic` instead: it still renders on
 *   the server, and its code is a separate chunk fetched only on a page that
 *   embeds it.
 * - The address chip menu links here with an `?address=` value, which the
 *   widget passes to the tool. Reading the query string needs a Suspense
 *   boundary in the App Router; its fallback is the same tool with an empty
 *   first row, so the tool is in the server HTML either way.
 *
 * The file is a client module, as every widget component must be: a CMS
 * page renders its embeds on the server and hands each widget's component to
 * the client-side `WidgetWithContext`, and React can pass a component across
 * that boundary only when its module is marked `'use client'`.
 */
'use client';

import { Suspense } from 'react';
import dynamic from 'next/dynamic';
import { useSearchParams } from 'next/navigation';
import type { IWidgetComponentProps } from '@/types';

/**
 * The tracer in its own chunk, rendered on the server as usual so the page
 * arrives with the tool drawn.
 */
const AddressOriginsTool = dynamic(
    () => import('./AddressOriginsTool').then((mod) => mod.AddressOriginsTool)
);

/**
 * The tracer with its first row filled from the page link's `?address=`
 * value, so a visitor arriving from an address chip does not paste it again.
 */
function ForwardedAddressOriginsTool() {
    const searchParams = useSearchParams();

    return <AddressOriginsTool initialAddress={searchParams.get('address') ?? ''} />;
}

/**
 * Render the tracer inside a page body, without page chrome, so the
 * surrounding CMS text supplies the heading.
 *
 * @param _props - Widget props; unused, since the widget carries no server data.
 * @returns The Address Origins tracer.
 */
export function AddressOriginsWidget(_props: IWidgetComponentProps) {
    return (
        <Suspense fallback={<AddressOriginsTool />}>
            <ForwardedAddressOriginsTool />
        </Suspense>
    );
}
