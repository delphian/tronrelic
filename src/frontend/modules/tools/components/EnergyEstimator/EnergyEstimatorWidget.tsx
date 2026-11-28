/**
 * @fileoverview Widget renderer for the embeddable energy estimator.
 *
 * The tools module registers the estimator as the `tools:energy-estimator`
 * widget type so a CMS page can place it inside its text with a ` ```widget `
 * block. The widget registry in `widgets.core.ts` maps that id to this
 * component. The server sends no data for it, because the estimator only
 * works from what the visitor types, so the `data` prop is ignored.
 *
 * The file is a client module, as every widget component must be: a CMS
 * page renders its embeds on the server and hands each widget's component to
 * the client-side `WidgetWithContext`, and React can pass a component across
 * that boundary only when its module is marked `'use client'`.
 */
'use client';

import type { IWidgetComponentProps } from '@/types';
import { EnergyEstimatorForm } from './EnergyEstimatorForm';

/**
 * Render the estimator form inside a page body, without page chrome, so the
 * surrounding CMS text supplies the heading.
 *
 * @param _props - Widget props; unused, since the widget carries no server data.
 * @returns The energy estimator form.
 */
export function EnergyEstimatorWidget(_props: IWidgetComponentProps) {
    return <EnergyEstimatorForm />;
}
