/**
 * @fileoverview Widget renderer for the embeddable timestamp converter.
 *
 * The tools module registers the converter as the `tools:timestamp-converter`
 * widget type so a CMS page can place it inside its text with a ` ```widget `
 * block. The widget registry in `widgets.core.ts` maps that id to this
 * component. The server sends no data for it, because the converter only
 * works from what the visitor types, so the `data` prop is ignored.
 *
 * The file is a client module, as every widget component must be: a CMS
 * page renders its embeds on the server and hands each widget's component to
 * the client-side `WidgetWithContext`, and React can pass a component across
 * that boundary only when its module is marked `'use client'`.
 */
'use client';

import type { IWidgetComponentProps } from '@/types';
import { TimestampConverterForm } from './TimestampConverterForm';

/**
 * Render the converter form inside a page body, without page chrome, so the
 * surrounding CMS text supplies the heading.
 *
 * @param _props - Widget props; unused, since the widget carries no server data.
 * @returns The timestamp converter form.
 */
export function TimestampConverterWidget(_props: IWidgetComponentProps) {
    return <TimestampConverterForm />;
}
