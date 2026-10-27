/**
 * @fileoverview Tests for `appendCampaignParams`, the `@/types` helper that
 * publish sinks and the blog share row use to tag outbound links.
 *
 * The traffic module only learns where a visitor came from through these tags
 * when the app they clicked in sends no referrer, so a malformed or duplicated
 * tag would misfile visits silently. These tests pin the shape the traffic
 * module's channel classifier and campaigns view expect.
 */

import { describe, it, expect } from 'vitest';
import { appendCampaignParams, CAMPAIGN_MEDIUM_SOCIAL, SYNDICATION_CAMPAIGN } from '@/types';
import { classifyChannel } from '../services/channel-classifier.js';

/** The tags a publish sink adds, reused across cases. */
const SYNDICATION = { source: 'telegram', medium: CAMPAIGN_MEDIUM_SOCIAL, campaign: SYNDICATION_CAMPAIGN };

describe('appendCampaignParams', () => {
    it('adds the three UTM parameters to a bare URL', () => {
        const tagged = appendCampaignParams('https://tronrelic.com/blog/some-post', SYNDICATION);

        expect(tagged).toBe('https://tronrelic.com/blog/some-post?utm_source=telegram&utm_medium=social&utm_campaign=syndication');
    });

    it('keeps existing query parameters and the fragment', () => {
        const tagged = new URL(appendCampaignParams('https://tronrelic.com/relics/abc?view=full#notes', SYNDICATION));

        expect(tagged.searchParams.get('view')).toBe('full');
        expect(tagged.searchParams.get('utm_source')).toBe('telegram');
        expect(tagged.hash).toBe('#notes');
    });

    it('replaces UTM values the URL already carries instead of adding a second set', () => {
        const tagged = new URL(appendCampaignParams('https://tronrelic.com/blog/p?utm_source=old&utm_campaign=old', SYNDICATION));

        expect(tagged.searchParams.getAll('utm_source')).toEqual(['telegram']);
        expect(tagged.searchParams.getAll('utm_campaign')).toEqual(['syndication']);
    });

    it('encodes values that need it', () => {
        const tagged = new URL(appendCampaignParams('https://tronrelic.com/', { source: 'a b&c', medium: 'social', campaign: 'x' }));

        expect(tagged.searchParams.get('utm_source')).toBe('a b&c');
    });

    it.each(['', '/blog/relative-path', 'not a url'])('returns %j unchanged because it is not an absolute URL', input => {
        expect(appendCampaignParams(input, SYNDICATION)).toBe(input);
    });

    it('uses the medium the channel classifier files under Social', () => {
        expect(classifyChannel({ refererDomain: null, utmMedium: CAMPAIGN_MEDIUM_SOCIAL, utmSource: 'telegram' })).toBe('social');
    });
});
