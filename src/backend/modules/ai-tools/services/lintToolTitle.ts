/**
 * @file lintToolTitle.ts
 *
 * Registration-time check of a tool's display title.
 *
 * People see a tool's `title` in place of its name: in an MCP client's tool
 * list and permission prompts, and in Anthropic's connector directory, whose
 * review requires one on every tool. A tool without one falls back to a title
 * generated from its name, which reads like code ("Resource Markets Get
 * Prices"), so a missing or malformed title is worth a warning at boot. It is
 * never an error, because a title changes nothing about how a tool behaves.
 */

import type { IAiTool } from '@/types';

/** Longest title the check accepts without a warning; clients truncate long ones. */
export const MAX_TOOL_TITLE_LENGTH = 60;

/**
 * Find problems with a tool's display title.
 *
 * @param tool - The tool being registered.
 * @returns One warning message per problem; empty when the title is fine.
 */
export function lintToolTitle(tool: IAiTool): string[] {
    const warnings: string[] = [];
    const title = typeof tool.title === 'string' ? tool.title.trim() : '';

    if (title.length === 0) {
        warnings.push(
            `AI tool "${tool.name}" has no title; clients will show one generated from its name. `
            + 'Add a short sentence-case title that starts with a verb, such as "Compare energy rental prices".'
        );
    } else if (title.length > MAX_TOOL_TITLE_LENGTH) {
        warnings.push(
            `AI tool "${tool.name}" has a ${title.length}-character title; keep it to ${MAX_TOOL_TITLE_LENGTH} `
            + 'or fewer so clients do not cut it off.'
        );
    }

    return warnings;
}
