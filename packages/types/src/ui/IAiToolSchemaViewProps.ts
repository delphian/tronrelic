/**
 * Published props for the AI tool parameter view exposed to plugins on
 * `context.system`.
 *
 * The view began inside the `/system/ai-tools` detail panel. Publishing it lets
 * a plugin that lists its own tools on its admin page show each tool's input
 * parameters the same way the core page does, instead of either leaving them
 * out or keeping a second copy of the rendering that drifts from the first.
 *
 * The implementation takes exactly this interface, so the published shape and
 * the component cannot disagree.
 */

import type { IAiToolInputSchema } from '../ai-tools/IAiTool.js';

/**
 * Props accepted by the AI tool parameter view.
 */
export interface IAiToolSchemaViewProps {
    /**
     * The tool's input schema, as carried on `IAiToolInfo.inputSchema`. Each
     * top-level property renders as one parameter with its type, whether it is
     * required, and its description. A schema with no properties renders a
     * short "takes no parameters" note rather than an empty list.
     */
    schema: IAiToolInputSchema;
}
