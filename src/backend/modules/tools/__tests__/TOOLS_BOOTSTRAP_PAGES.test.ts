/// <reference types="vitest" />

/**
 * @fileoverview Unit tests for the CMS pages the tools module offers.
 *
 * Listing and creating them is the pages module's shared bootstrap service,
 * tested in `page-bootstrap.service.test.ts`. What belongs to this module is
 * what each proposed page says. Each page is the only thing served at its
 * tool's address, so its body must embed the tool.
 */

import { describe, it, expect } from 'vitest';
import { TOOLS_BOOTSTRAP_PAGES } from '../services/TOOLS_BOOTSTRAP_PAGES.js';

describe('TOOLS_BOOTSTRAP_PAGES', () => {
    it('proposes a page whose body embeds the calculator widget at its default address', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[0];

        expect(proposal.slug).toBe('/tools/stake-calculator');
        expect(proposal.source).toBe('tools-module');
        expect(proposal.body).toContain('```widget\n{"type":"tools:stake-calculator","config":{},"required":true}\n```');
    });

    it('proposes the staking rewards page with its calculator widget at its default address', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[1];

        expect(proposal.slug).toBe('/tools/staking-rewards');
        expect(proposal.source).toBe('tools-module');
        expect(proposal.body).toContain('```widget\n{"type":"tools:staking-rewards","config":{},"required":true}\n```');
    });

    it('proposes the energy estimator page with its estimator widget at its default address', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[2];

        expect(proposal.slug).toBe('/tools/energy-estimator');
        expect(proposal.source).toBe('tools-module');
        expect(proposal.body).toContain('```widget\n{"type":"tools:energy-estimator","config":{},"required":true}\n```');
    });

    it('proposes the timestamp converter page with its converter widget at its default address', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[3];

        expect(proposal.slug).toBe('/tools/timestamp-converter');
        expect(proposal.source).toBe('tools-module');
        expect(proposal.body).toContain('```widget\n{"type":"tools:timestamp-converter","config":{},"required":true}\n```');
    });

    it('proposes the address converter page with its converter widget at its default address', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[4];

        expect(proposal.slug).toBe('/tools/address-converter');
        expect(proposal.source).toBe('tools-module');
        expect(proposal.body).toContain('```widget\n{"type":"tools:address-converter","config":{},"required":true}\n```');
    });

    it('proposes the address generator page with its generator widget at its default address', () => {
        const { proposal } = TOOLS_BOOTSTRAP_PAGES[5];

        expect(proposal.slug).toBe('/tools/address-generator');
        expect(proposal.source).toBe('tools-module');
        expect(proposal.body).toContain('```widget\n{"type":"tools:address-generator","config":{},"required":true}\n```');
    });

    /**
     * The pages module describes a page as a `WebApplication` only when its
     * body has a required embed. Without the flag each tool page goes out to
     * search engines as an `Article`.
     */
    it('marks every tool embed required', () => {
        for (const { proposal } of TOOLS_BOOTSTRAP_PAGES) {
            expect(proposal.body).toContain('"required":true');
        }
    });

    it('gives every entry its own id', () => {
        const ids = TOOLS_BOOTSTRAP_PAGES.map((item) => item.id);

        expect(new Set(ids).size).toBe(ids.length);
    });
});
