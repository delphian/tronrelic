/**
 * @fileoverview Source-app classification for traffic events.
 *
 * Names the social or messaging app whose in-app browser a request came
 * from, read from the User-Agent, and stores it on `traffic_events.source_app`
 * at write time. The point is attribution: those browsers open a link without
 * sending a `Referer` header, so a visit from a Douyin caption or a WeChat
 * chat used to read `direct` on every surface, and the app's name sat unread
 * in the User-Agent column. The source bucket reads this column after the
 * referrer and after `utm_source`, and the channel classifier files a visit
 * that has only this signal under `social`.
 *
 * Only social and messaging apps are listed, because the channel claim
 * depends on it: every app here is one whose visit is a social referral.
 * Telegram and WhatsApp are deliberately absent. They open links in the
 * system browser or in a WebView that carries no app marker, so they cannot
 * be told apart from a plain browser here and stay covered by the UTM tags
 * the platform puts on the links it posts.
 *
 * Matching mirrors the bot classifier: `includes` on a lowercased,
 * length-clamped User-Agent, rules in declaration order, no user-controlled
 * regex. A fragment is chosen to be specific to the app's own browser, so a
 * browser merely named after an app (QQ Browser, say) does not match.
 */

/**
 * Closed vocabulary written to `traffic_events.source_app`. Stored as
 * `LowCardinality(Nullable(String))`; `null` means the request did not come
 * through a listed app, which is also what every row written before the
 * column existed carries.
 */
export type SourceApp =
    | 'douyin'
    | 'tiktok'
    | 'xiaohongshu'
    | 'wechat'
    | 'qq'
    | 'weibo'
    | 'bilibili'
    | 'zhihu'
    | 'line'
    | 'kakaotalk'
    | 'messenger'
    | 'facebook'
    | 'instagram'
    | 'twitter'
    | 'snapchat'
    | 'reddit'
    | 'linkedin'
    | 'pinterest'
    | 'discord';

/**
 * User-Agent fragments per app, lowercased. Order matters where one app's
 * browser carries another's marker: Messenger identifies itself as a
 * Facebook app (`FBAN/MessengerForiOS`), so it is tested first, and Douyin
 * is tested before TikTok because the two share ByteDance's WebView stack.
 */
const RULES: ReadonlyArray<{ app: SourceApp; fragments: readonly string[] }> = [
    // Douyin names itself by its internal product name, `aweme`.
    { app: 'douyin', fragments: ['aweme', 'douyin'] },
    { app: 'tiktok', fragments: ['tiktok', 'musical_ly'] },
    { app: 'xiaohongshu', fragments: ['xhs/', 'xiaohongshu'] },
    { app: 'wechat', fragments: ['micromessenger'] },
    // The leading space keeps QQ Browser (`MQQBrowser/`) from matching.
    { app: 'qq', fragments: [' qq/'] },
    { app: 'weibo', fragments: ['weibo'] },
    { app: 'bilibili', fragments: ['bilibili'] },
    { app: 'zhihu', fragments: ['zhihu'] },
    // The leading space keeps ordinary words ending in "line" from matching.
    { app: 'line', fragments: [' line/'] },
    { app: 'kakaotalk', fragments: ['kakaotalk'] },
    { app: 'messenger', fragments: ['messengerforios', 'orca-android', 'messengerlite'] },
    { app: 'facebook', fragments: ['fban/', 'fbav/', 'fb_iab'] },
    { app: 'instagram', fragments: ['instagram'] },
    { app: 'twitter', fragments: ['twitter for iphone', 'twitter for ipad', 'twitterandroid'] },
    { app: 'snapchat', fragments: ['snapchat'] },
    // The leading space keeps the `Redditbot/` unfurler from matching.
    { app: 'reddit', fragments: [' reddit/'] },
    { app: 'linkedin', fragments: ['linkedinapp'] },
    { app: 'pinterest', fragments: ['pinterest for ', 'pinterest/android'] },
    { app: 'discord', fragments: ['discord/'] }
];

/**
 * Cap User-Agent length before lowercasing and matching, so a hostile
 * header cannot drive CPU on the request path. Matches the bot classifier's
 * and `getDeviceCategory`'s cap.
 */
const MAX_UA_LENGTH = 500;

/**
 * Name the social or messaging app whose in-app browser sent a request.
 *
 * Returns `null` for a plain browser, a bot, or a missing header, which is
 * the common case; a non-null answer is what lets the source bucket and the
 * channel classifier credit a referrer-less visit to the app it came from.
 *
 * @param userAgent - Raw `User-Agent` header value, or null/undefined.
 * @returns The app's id, or `null` when no listed app's marker is present.
 */
export function classifySourceApp(userAgent: string | null | undefined): SourceApp | null {
    let app: SourceApp | null = null;
    if (userAgent) {
        const ua = userAgent.slice(0, MAX_UA_LENGTH).toLowerCase();
        for (const rule of RULES) {
            if (app === null && rule.fragments.some(fragment => ua.includes(fragment))) {
                app = rule.app;
            }
        }
    }
    return app;
}
