/**
 * @fileoverview Widget-type registration for a tool that is only a form.
 *
 * Registering a tool as a widget type lets any CMS page or blog post embed it
 * with a ` ```widget ` block, which is how each proposed tool page places its
 * form inside editable text. The frontend renders it with the component keyed
 * on the same id in `widgets.core.ts`.
 *
 * - A form tool is driven entirely by what the visitor types, so the server
 *   supplies no data and the fetcher returns an empty object.
 * - It takes no settings, so it declares an empty settings schema and the
 *   Insert widget picker shows no form for it.
 * - It renders nothing taken from its settings and nothing specific to the
 *   visitor, so it is safe to embed in a page any author can propose.
 */

import type { IRegisterWidgetTypeInput } from '@/types';

/**
 * Build the registration input for a form tool's widget type.
 *
 * @param id - Widget-type id, shared with the frontend registry through `@/types`.
 * @param label - Name shown in the Insert widget picker.
 * @param description - Picker text telling an author what the embed does.
 * @returns Input for `IWidgetsService.registerType`, with the tools module's category.
 */
export function createToolFormWidgetType(id: string, label: string, description: string): IRegisterWidgetTypeInput {
    const input: IRegisterWidgetTypeInput = {
        id,
        label,
        description,
        category: 'Tools',
        defaultDataFetcher: async () => ({}),
        configSchema: { type: 'object', properties: {}, additionalProperties: false },
        embeddable: true
    };
    return input;
}
