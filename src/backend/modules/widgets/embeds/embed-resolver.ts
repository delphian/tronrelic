/**
 * @fileoverview Fetches the data for widgets embedded in a page or post body.
 *
 * The markdown renderer stores each ` ```widget ` block as a placeholder that
 * names a widget type and its settings. The content endpoint serving the body
 * hands the HTML to this resolver on each request, so the widget data is
 * current while the stored HTML never changes.
 *
 * An embed's settings were written by a page author, and authors include AI
 * tools and other non-curators whose drafts a curator reviews. So each embed
 * is checked again here, every time, before its fetcher runs:
 *
 * - the type must be registered and declare itself embeddable;
 * - the settings must pass the type's schema, the same check a placement passes;
 * - a body holds at most `MAX_EMBEDS_PER_BODY` embeds, so one page cannot
 *   start an unbounded number of fetches per request.
 *
 * Results are returned in placeholder order, with null for any embed that is
 * skipped, so the frontend pairs each placeholder with its data by index.
 */

import type {
    ISystemLogService,
    IWidgetData,
    IWidgetEmbed,
    IWidgetEmbedContext,
    IWidgetTypeRegistry
} from '@/types';
import { DEFAULT_LANGUAGE, splitWidgetEmbeds } from '@/types';
import { runWidgetFetcher } from '../placements/run-widget-fetcher.js';
import type { InstanceConfigValidator } from '../widget-types/instance-config-validator.js';

/** Most embeds one body may hold; later ones resolve to null. */
export const MAX_EMBEDS_PER_BODY = 20;

/**
 * Zone name embedded widgets carry in `IWidgetData.zone`. They sit in no
 * zone; the value only tells a renderer or a log reader where they came from.
 */
export const EMBED_ZONE = 'embed';

/**
 * Resolves embedded widgets to widget data. Constructed once by the widgets
 * module and used only through `WidgetsService.resolveEmbeds`.
 */
export class EmbedResolver {
    /**
     * @param widgetTypes - Looks up each embed's type, fetcher, and owner.
     * @param configValidator - The schema check placements also pass.
     * @param logger - Records embeds that are skipped and why.
     */
    constructor(
        private readonly widgetTypes: IWidgetTypeRegistry,
        private readonly configValidator: InstanceConfigValidator,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * Resolve every placeholder in a body, in document order.
     *
     * @param html - Sanitized HTML from the shared markdown renderer.
     * @param context - The page the body is shown on.
     * @returns One entry per placeholder; null where the embed is skipped.
     */
    async resolve(html: string, context: IWidgetEmbedContext): Promise<Array<IWidgetData | null>> {
        const embeds = splitWidgetEmbeds(html).flatMap(segment => (segment.kind === 'embed' ? [segment.embed] : []));
        if (embeds.length > MAX_EMBEDS_PER_BODY) {
            this.logger.warn(
                { route: context.route, embedCount: embeds.length, limit: MAX_EMBEDS_PER_BODY },
                'Body holds more embedded widgets than the limit; the extra ones are not rendered'
            );
        }
        return Promise.all(
            embeds.map((embed, index) => (index < MAX_EMBEDS_PER_BODY && embed ? this.resolveOne(embed, index, context) : null))
        );
    }

    /**
     * Check one embed and run its fetcher.
     *
     * @param embed - The decoded embed.
     * @param index - Its position among the body's placeholders.
     * @param context - The page the body is shown on.
     * @returns The widget data, or null when the embed is skipped.
     */
    private async resolveOne(embed: IWidgetEmbed, index: number, context: IWidgetEmbedContext): Promise<IWidgetData | null> {
        const logContext = { route: context.route, embedIndex: index, typeId: embed.type };
        const type = this.widgetTypes.get(embed.type);
        let result: IWidgetData | null = null;
        if (!type) {
            // Usually a disabled plugin; the embed returns when it is re-enabled.
            this.logger.debug(logContext, 'Embedded widget type is not registered');
        } else if (!type.embeddable) {
            this.logger.warn(logContext, 'Embedded widget type does not allow embedding');
        } else {
            const errors = this.configValidator.validate(type.id, type.configSchema, embed.config);
            if (errors) {
                this.logger.warn({ ...logContext, errors }, 'Embedded widget settings fail the type schema');
            } else {
                const data = await runWidgetFetcher(
                    type,
                    context.route,
                    context.params ?? {},
                    { id: `embed-${index}`, instanceConfig: embed.config, language: context.language ?? DEFAULT_LANGUAGE },
                    this.logger,
                    logContext
                );
                if (data !== null) {
                    result = {
                        id: type.id,
                        zone: EMBED_ZONE,
                        pluginId: this.widgetTypes.getOwnerPluginId(type.id) ?? 'unknown',
                        order: index,
                        data,
                        instanceConfig: embed.config
                    };
                }
            }
        }
        return result;
    }
}
