/// <reference types="vitest" />

/**
 * Tests for the User-Agent classifier that populates
 * `traffic_events.source_app`.
 *
 * Each app gets at least one real-world in-app browser User-Agent, and the
 * negative cases pin the two mistakes the fragment choices exist to avoid: a
 * browser merely named after an app (QQ Browser) must not match, and a plain
 * browser or a bot must read null. The Douyin sample is the production row
 * that motivated the column.
 */

import { describe, it, expect } from 'vitest';
import { classifySourceApp } from '../services/source-app-classifier.js';

describe('classifySourceApp', () => {
    it.each([
        ['douyin', 'Mozilla/5.0 (Linux; Android 10; HD1900 Build/QKQ1.190716.003; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/75.0.3770.156 Mobile Safari/537.36  aweme_230400 JsSdk/1.0 NetType/WIFI  AppName/aweme app_version/23.4.0 ByteLocale'],
        ['tiktok', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_32.5.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US'],
        ['xiaohongshu', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 discover/8.20 XHS/8.20.0 NetType/WiFi'],
        ['wechat', 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.42 NetType/WIFI Language/zh_CN'],
        ['qq', 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 V1_AND_SQ_8.9.80 QQ/8.9.80.12345 NetType/WIFI'],
        ['weibo', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Weibo (iPhone15,2__weibo__13.10.0__iphone__os17.0)'],
        ['line', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Safari Line/13.18.0/IAB'],
        ['kakaotalk', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.4.0'],
        ['messenger', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/MessengerForiOS;FBAV/430.0.0;FBBV/1;FBDV/iPhone15,2]'],
        ['facebook', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/430.0.0.30.107;FBBV/1;FBDV/iPhone15,2;FBMD/iPhone]'],
        ['instagram', 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.29.110 Android'],
        ['twitter', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Twitter for iPhone/10.0'],
        ['snapchat', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Snapchat/12.50.0.30 (iPhone15,2; iOS 17.0; gzip)'],
        ['reddit', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Reddit/Version 2023.40.0/Build 1180124/iOS 17.0'],
        ['linkedin', 'Mozilla/5.0 (Linux; Android 13; Pixel 7 Build/TQ3A.230805.001; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/116.0.0.0 Mobile Safari/537.36 LinkedInApp'],
        ['pinterest', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [Pinterest for iOS/11.40 (iPhone15,2; 17.0)]'],
        ['discord', 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Discord/200.0 (iPhone15,2; iOS 17.0)']
    ])('names %s from its in-app browser User-Agent', (app, userAgent) => {
        expect(classifySourceApp(userAgent)).toBe(app);
    });

    it('tests Messenger before Facebook, since Messenger carries the Facebook marker too', () => {
        expect(classifySourceApp('[FBAN/MessengerForiOS;FBAV/430.0.0]')).toBe('messenger');
    });

    it('reads null for a plain browser', () => {
        expect(classifySourceApp('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36')).toBeNull();
        expect(classifySourceApp('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1')).toBeNull();
    });

    it('does not mistake a browser named after an app for the app', () => {
        // QQ Browser is a browser, not the QQ messenger's in-app view.
        expect(classifySourceApp('Mozilla/5.0 (Linux; Android 13) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/116.0.0.0 MQQBrowser/6.2 Mobile Safari/537.36')).toBeNull();
        // The Reddit unfurler is a bot, not the Reddit app.
        expect(classifySourceApp('Mozilla/5.0 (compatible; Redditbot/1.0; +http://www.reddit.com/feedback)')).toBeNull();
    });

    it('reads null for a missing header', () => {
        expect(classifySourceApp(null)).toBeNull();
        expect(classifySourceApp(undefined)).toBeNull();
        expect(classifySourceApp('')).toBeNull();
    });

    it('matches regardless of case', () => {
        expect(classifySourceApp('MOZILLA/5.0 MICROMESSENGER/8.0')).toBe('wechat');
    });

    it('ignores a marker pushed past the length cap', () => {
        expect(classifySourceApp(`${'x'.repeat(600)} MicroMessenger/8.0`)).toBeNull();
    });
});
