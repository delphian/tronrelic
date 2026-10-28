/**
 * @fileoverview Tests for `readUtmParams`, the `@/types` helper the Next.js
 * middleware and the browser page beacon both use to read a landing URL's
 * UTM tags.
 *
 * A link cited by an AI assistant's app arrives with no referrer, so its
 * `utm_source` is the only record of where the visit came from. These tests
 * pin which keys are accepted and that an untagged URL yields null, which both
 * callers rely on to leave the field out of their payload.
 */

import { describe, it, expect } from 'vitest';
import { readUtmParams } from '@/types';
import { classifyChannel } from '../services/channel-classifier.js';

describe('readUtmParams', () => {
    it('reads a source-only tag, the shape ChatGPT adds to cited links', () => {
        const utm = readUtmParams(new URLSearchParams('utm_source=chatgpt.com'));
        expect(utm).toEqual({ source: 'chatgpt.com' });
        // The tag alone is enough for the classifier to file the visit as AI.
        expect(classifyChannel({ refererDomain: null, utmSource: utm?.source })).toBe('ai');
    });

    it('reads all five UTM keys and ignores other parameters', () => {
        const utm = readUtmParams(new URLSearchParams(
            'utm_source=x&utm_medium=social&utm_campaign=c&utm_term=t&utm_content=v&ref=abc&utm_id=9'
        ));
        expect(utm).toEqual({ source: 'x', medium: 'social', campaign: 'c', term: 't', content: 'v' });
    });

    it('returns null when the URL carries no tags or only empty ones', () => {
        expect(readUtmParams(new URLSearchParams(''))).toBeNull();
        expect(readUtmParams(new URLSearchParams('utm_source=&page=2'))).toBeNull();
    });
});
