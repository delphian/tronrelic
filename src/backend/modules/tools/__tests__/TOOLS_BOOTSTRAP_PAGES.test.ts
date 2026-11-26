/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the CMS pages the tools module offers.
 *
 * Listing and creating them is the pages module's shared bootstrap service,
 * tested in `page-bootstrap.service.test.ts`. What belongs to this module is
 * what each proposed page says, so approving it changes no visible text.
 */

import { describe, it, expect } from 'vitest';
import { TOOLS_BOOTSTRAP_PAGES } from '../services/TOOLS_BOOTSTRAP_PAGES.js';

describe('TOOLS_BOOTSTRAP_PAGES', () => {
    it('proposes a page whose body embeds the calculator widget at its default address', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[0];

        expect(proposal.slug).toBe('/tools/stake-calculator');
        expect(proposal.source).toBe('tools-module');
        expect(proposal.body).toContain('```widget\n{"type":"tools:stake-calculator","config":{}}\n```');
    });

    /**
     * Approving the page must change no visible text, so the proposal repeats
     * the built-in page's title, description, heading, and intro line. These
     * literals mirror the `t()` defaults in StakeCalculator.tsx and the
     * stake calculator route's metadata.
     */
    it('proposes the same visible text the built-in page shows', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[0];

        expect(proposal.title).toBe('TRON Stake Calculator | TRX Staking Energy & Bandwidth Yield');
        expect(proposal.description).toBe('Calculate energy and bandwidth yield from staking TRX on the TRON network. Compare staking returns against renting energy from delegation markets.');
        expect(proposal.body.startsWith('# Stake Calculator\n\nCalculate energy from TRX or TRX from energy using live network parameters\n\n```widget')).toBe(true);
    });

    it('gives every entry its own id', () => {
        const ids = TOOLS_BOOTSTRAP_PAGES.map((item) => item.id);

        expect(new Set(ids).size).toBe(ids.length);
    });
});
