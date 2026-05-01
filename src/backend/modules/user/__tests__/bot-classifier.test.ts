/// <reference types="vitest" />

/**
 * Tests for the User-Agent classifier that populates
 * `traffic_events.bot_class`.
 *
 * Each `BotClass` value gets coverage from at least two real-world UA
 * strings so a regression in any single fragment shows up. Edge cases
 * (missing UA, length-clamp, casing, isbot fallback) live in their
 * own describe block so adding new categories doesn't push them down
 * the file.
 */

import { describe, it, expect } from 'vitest';
import { classifyUserAgent } from '../services/bot-classifier.js';

describe('classifyUserAgent', () => {
    describe('search_engine', () => {
        it.each([
            ['Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)'],
            ['Mozilla/5.0 (compatible; Googlebot-Image/1.0)'],
            ['Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)'],
            ['DuckDuckBot/1.1; (+http://duckduckgo.com/duckduckbot.html)'],
            ['Mozilla/5.0 (compatible; YandexBot/3.0; +http://yandex.com/bots)'],
            ['Mozilla/5.0 (compatible; Baiduspider/2.0; +http://www.baidu.com/search/spider.html)'],
            ['Sogou web spider/4.0(+http://www.sogou.com/docs/help/webmasters.htm#07)'],
            ['Mozilla/5.0 (compatible; Applebot/0.1; +http://www.apple.com/go/applebot)']
        ])('classifies %p as search_engine', (ua) => {
            expect(classifyUserAgent(ua)).toBe('search_engine');
        });
    });

    describe('ai_crawler', () => {
        it.each([
            ['Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.2; +https://openai.com/gptbot'],
            ['Mozilla/5.0 (compatible; ChatGPT-User/1.0; +https://openai.com/bot)'],
            ['Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)'],
            ['Mozilla/5.0 (compatible; PerplexityBot/1.0; +https://docs.perplexity.ai/docs/perplexity-bot)'],
            ['CCBot/2.0 (https://commoncrawl.org/faq/)'],
            ['Mozilla/5.0 (compatible; Bytespider; spider-feedback@bytedance.com)'],
            ['anthropic-ai']
        ])('classifies %p as ai_crawler', (ua) => {
            expect(classifyUserAgent(ua)).toBe('ai_crawler');
        });

        it('classifies Google-Extended as ai_crawler even when UA also contains Googlebot', () => {
            // Google publishes Google-Extended as a separate opt-out token
            // for Gemini training. Some crawl variants advertise both
            // tokens in the same UA; the operator-meaningful classification
            // is "AI training crawl", not "search ranking crawl".
            const ua = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html) Google-Extended';
            expect(classifyUserAgent(ua)).toBe('ai_crawler');
        });
    });

    describe('social_unfurler', () => {
        it.each([
            ['Slackbot-LinkExpanding 1.0 (+https://api.slack.com/robots)'],
            ['Twitterbot/1.0'],
            ['facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'],
            ['LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)'],
            ['Mozilla/5.0 (compatible; Discordbot/2.0; +https://discordapp.com)'],
            ['TelegramBot (like TwitterBot)'],
            ['WhatsApp/2.23.20.0 A']
        ])('classifies %p as social_unfurler', (ua) => {
            expect(classifyUserAgent(ua)).toBe('social_unfurler');
        });
    });

    describe('uptime_probe', () => {
        it.each([
            ['Mozilla/5.0 (compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)'],
            ['Pingdom.com_bot_version_1.4_(http://www.pingdom.com/)'],
            ['Mozilla/5.0 (compatible; StatusCake)'],
            ['Better Uptime Bot Manifold/1.0 (https://betteruptime.com)'],
            ['Datadog Agent/7.0']
        ])('classifies %p as uptime_probe', (ua) => {
            expect(classifyUserAgent(ua)).toBe('uptime_probe');
        });
    });

    describe('human', () => {
        it.each([
            ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'],
            ['Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15'],
            ['Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'],
            ['Mozilla/5.0 (X11; Linux x86_64; rv:128.0) Gecko/20100101 Firefox/128.0']
        ])('classifies %p as human', (ua) => {
            expect(classifyUserAgent(ua)).toBe('human');
        });
    });

    describe('bot_other (isbot fallback and missing UA)', () => {
        it('classifies a generic crawler UA as bot_other', () => {
            // Some random crawler `isbot` knows about but we don't track
            // explicitly. Picking one with no overlap with the explicit
            // categories so the test stays stable as new fragments land.
            expect(classifyUserAgent('AhrefsBot/7.0 (+http://ahrefs.com/robot/)')).toBe('bot_other');
        });

        it('classifies python-requests as bot_other', () => {
            expect(classifyUserAgent('python-requests/2.31.0')).toBe('bot_other');
        });

        it('returns bot_other for null UA', () => {
            expect(classifyUserAgent(null)).toBe('bot_other');
        });

        it('returns bot_other for undefined UA', () => {
            expect(classifyUserAgent(undefined)).toBe('bot_other');
        });

        it('returns bot_other for empty string UA', () => {
            expect(classifyUserAgent('')).toBe('bot_other');
        });
    });

    describe('robustness', () => {
        it('matches case-insensitively', () => {
            expect(classifyUserAgent('GOOGLEBOT/2.1')).toBe('search_engine');
            expect(classifyUserAgent('GptBot/1.0')).toBe('ai_crawler');
        });

        it('handles UA strings longer than the 500-char cap without throwing', () => {
            // Pad past the cap with garbage that doesn't match any rule;
            // the prefix carries the matching fragment.
            const ua = 'Twitterbot/1.0' + ' '.repeat(600) + 'Googlebot';
            expect(classifyUserAgent(ua)).toBe('social_unfurler');
        });

        it('returns the first explicit-rule match when a UA contains multiple fragments', () => {
            // ai_crawler runs before search_engine in the rule order,
            // so a UA containing both `googlebot` and `gptbot` resolves
            // to ai_crawler. This documents the ordering choice.
            expect(classifyUserAgent('GPTBot/1.0 Googlebot/2.1')).toBe('ai_crawler');
        });
    });
});
