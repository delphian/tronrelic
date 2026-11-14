/**
 * @fileoverview Tests for the registration-time title check.
 *
 * A tool's title is what people see in MCP clients and Anthropic's connector
 * directory, whose review requires one. These tests lock that a missing,
 * blank, or over-long title produces a warning and a good one produces none.
 */

import { describe, it, expect } from 'vitest';
import type { IAiTool } from '@/types';
import { lintToolTitle, MAX_TOOL_TITLE_LENGTH } from '../services/lintToolTitle.js';

/**
 * Build a minimal tool with an optional title.
 *
 * @param title - The title to declare, or undefined for none.
 * @returns A tool the check can read.
 */
function toolWith(title?: string): IAiTool {
    return {
        name: 'markets-get-prices',
        title,
        description: 'Report prices.',
        inputSchema: { type: 'object', properties: {} },
        handler: async () => null
    };
}

describe('lintToolTitle', () => {
    it('accepts a short, plain title', () => {
        expect(lintToolTitle(toolWith('Compare energy rental prices'))).toEqual([]);
    });

    it('warns when the title is missing or blank', () => {
        expect(lintToolTitle(toolWith())).toHaveLength(1);
        expect(lintToolTitle(toolWith('   '))[0]).toContain('has no title');
    });

    it('warns when the title is longer than the limit', () => {
        const warnings = lintToolTitle(toolWith('x'.repeat(MAX_TOOL_TITLE_LENGTH + 1)));
        expect(warnings).toHaveLength(1);
        expect(warnings[0]).toContain(`${MAX_TOOL_TITLE_LENGTH + 1}-character title`);
    });
});
