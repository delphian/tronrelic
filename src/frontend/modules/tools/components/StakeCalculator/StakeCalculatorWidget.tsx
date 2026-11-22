/**
 * @fileoverview Widget renderer for the embeddable stake calculator.
 *
 * The tools module registers the calculator as the `tools:stake-calculator`
 * widget type so a CMS page can place it inside its text with a ` ```widget `
 * block. The widget registry in `widgets.core.ts` maps that id to this
 * component. The server sends no data for it, because the calculator only
 * works from what the visitor types, so the `data` prop is ignored.
 */

import type { IWidgetComponentProps } from '@/types';
import { StakeCalculatorForm } from './StakeCalculatorForm';

/**
 * Render the calculator form inside a page body, without page chrome, so the
 * surrounding CMS text supplies the heading.
 *
 * @param _props - Widget props; unused, since the widget carries no server data.
 * @returns The stake calculator form.
 */
export function StakeCalculatorWidget(_props: IWidgetComponentProps) {
    return <StakeCalculatorForm />;
}
