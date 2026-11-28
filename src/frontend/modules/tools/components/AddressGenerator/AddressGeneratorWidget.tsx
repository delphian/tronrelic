/**
 * @fileoverview Widget renderer for the embeddable address generator.
 *
 * The tools module registers the generator as the `tools:address-generator`
 * widget type so a CMS page can place it inside its text with a ` ```widget `
 * block. The widget registry in `widgets.core.ts` maps that id to this
 * component. The server sends no data for it, so the `data` prop is ignored.
 *
 * The registry is loaded with the site layout, so anything this file imports
 * statically is downloaded on every page. The generator brings a QR code
 * library with it, so the form is loaded through `next/dynamic` instead: it
 * still renders on the server inside the CMS page, and its code is a separate
 * chunk fetched only on a page that embeds it.
 *
 * The file is a client module, as every widget component must be: a CMS
 * page renders its embeds on the server and hands each widget's component to
 * the client-side `WidgetWithContext`, and React can pass a component across
 * that boundary only when its module is marked `'use client'`.
 */
'use client';

import dynamic from 'next/dynamic';
import type { IWidgetComponentProps } from '@/types';

/**
 * The generator form in its own chunk, rendered on the server as usual so
 * the page arrives with the tool drawn.
 */
const AddressGeneratorForm = dynamic(
    () => import('./AddressGeneratorForm').then((mod) => mod.AddressGeneratorForm)
);

/**
 * Render the generator inside a page body, without page chrome, so the
 * surrounding CMS text supplies the heading.
 *
 * @param _props - Widget props; unused, since the widget carries no server data.
 * @returns The address generator.
 */
export function AddressGeneratorWidget(_props: IWidgetComponentProps) {
    return <AddressGeneratorForm />;
}
