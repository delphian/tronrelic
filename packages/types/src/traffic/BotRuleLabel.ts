/**
 * @fileoverview The bot classes a bot rule may assign to a traffic event.
 *
 * Why it exists: a bot rule moves an event that the built-in classifier left as
 * `human` into one of the bot classes the traffic dashboard already charts. The
 * list mirrors the backend `BotClass` enum minus `human`, because a rule may only
 * ever move an event toward "bot", never back to human.
 */

/**
 * A bot class a rule can write to `traffic_events.bot_class`.
 */
export type BotRuleLabel =
    | 'search_engine'
    | 'ai_crawler'
    | 'social_unfurler'
    | 'uptime_probe'
    | 'scanner'
    | 'bot_other';
