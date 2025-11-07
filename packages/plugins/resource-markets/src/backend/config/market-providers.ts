/**
 * Market provider configuration for all supported energy markets.
 *
 * Each market includes:
 * - API endpoints for fetching market data
 * - Site links (with optional affiliate codes and conversion tracking)
 * - Social media links
 * - Known blockchain addresses (billing, payout, authorize)
 * - Affiliate configuration
 *
 * Note: In the plugin version, configurations are hardcoded.
 * Future enhancement: Move to plugin settings UI for runtime configuration.
 */

export interface MarketProviderSettings {
    endpoints: Record<string, string>;
    siteLinks?: Array<{ link: string; text?: string; conversion?: string }>;
    social?: Array<{ platform: string; link: string; icon?: string; label?: string }>;
    addresses?: Array<{ address: string; labels?: string[] }>;
    affiliateLink?: string;
    minOrder?: number;
}

const defaults = {
    tronEnergyMarket: {
        endpoints: {
            info: 'https://api.tronenergy.market/info',
            orders: 'https://api.tronenergy.market/order/list/?limit=100&skip=0'
        },
        siteLinks: [
            {
                link: 'https://tronenergy.market/?ref=TCRq2FJVoN5mpHJgBR6KcavKWEYhQ45BrK',
                text: 'Tron Energy Market',
                conversion: 'AW-16717420950/EGWHCNP6ttsZEJazvqM-'
            },
            {
                link: 'https://tronenergy.market/?ref=TCRq2FJVoN5mpHJgBR6KcavKWEYhQ45BrK',
                text: '<span class="badge bg-secondary bg-success">Buy Energy</span>',
                conversion: 'AW-16717420950/EGWHCNP6ttsZEJazvqM-'
            },
            {
                link: 'https://tronenergy.market/?ref=TCRq2FJVoN5mpHJgBR6KcavKWEYhQ45BrK',
                text: '<span class="badge bg-secondary bg-dark text-warning">能量 租赁</span>',
                conversion: 'AW-16717420950/EGWHCNP6ttsZEJazvqM-'
            }
        ],
        social: [
            { platform: 'Telegram', link: 'https://t.me/tronenergy_market', icon: 'bi-telegram' },
            { platform: 'Twitter', link: 'https://twitter.com/tronenergy_mkt', icon: 'bi-twitter-x' },
            { platform: 'GitHub', link: 'https://github.com/tronenergymarket/tronenergy-api-examples', icon: 'bi-github' }
        ],
        addresses: [
            { address: 'TEMkRxLtCCdL4BCwbPXbbNWe4a9gtJ7kq7', labels: ['billing', 'payout', 'authorize'] }
        ],
        affiliateLink: 'https://tronenergy.market/?ref=TCRq2FJVoN5mpHJgBR6KcavKWEYhQ45BrK',
        minOrder: 32_000
    },
    tronEnergy: {
        endpoints: {
            summary: 'https://itrx.io/api/v1/frontend/index-data'
        },
        siteLinks: [{ link: 'https://itrx.io', text: 'Tron Energy' }],
        social: [{ platform: 'Telegram', link: 'https://t.me/itrx1', icon: 'bi-telegram' }],
        addresses: [{ address: 'TEX5nLeFJ1dyazhJC3P9eYJs7hxgk7knJY', labels: ['billing'] }],
        affiliateLink: 'https://itrx.io',
        minOrder: 32_000
    },
    feeeIo: {
        endpoints: {
            energy: 'https://feee.io/v1/order/usable_energy',
            config: 'https://feee.io/v1/init/config',
            trades: 'https://feee.io/v1/order/trades'
        },
        siteLinks: [
            { link: 'https://feee.io/?ic=33FH', text: 'Feee.io', conversion: 'AW-16717420950/EGWHCNP6ttsZEJazvqM-' }
        ],
        social: [
            { platform: 'Telegram', link: 'https://t.me/tronenergymarkets', label: 'Channel', icon: 'bi-telegram' },
            { platform: 'Telegram', link: 'https://t.me/trongascom', label: 'Contact (Service)', icon: 'bi-telegram' },
            { platform: 'Telegram', link: 'https://t.me/feeeIoBot?start=33FH', label: 'Lending Bot', icon: 'bi-telegram' },
            { platform: 'Twitter', link: 'https://x.com/Feeeio', icon: 'bi-twitter-x' }
        ],
        addresses: [
            { address: 'TGNuLPkkgsf42xdRSXYpVSqUvtFT4HEupg', labels: ['authorize'] },
            { address: 'TUeq6WKpJZXMDQ4PgnMgL1xVTAETBAQo9f', labels: ['payout'] },
            { address: 'TYoAtLwBpWbknJuL4ACW6oXm4AVVbPRXDH', labels: ['billing'] },
            { address: 'TMq4o2LTj13WqcTCc2GCyuBwWAxnvsBD2v', labels: ['billing'] }
        ],
        affiliateLink: 'https://feee.io/?ic=33FH',
        minOrder: 32_000
    },
    tronSave: {
        endpoints: {
            graphql: 'https://api-dashboard.tronsave.io/graphql'
        },
        siteLinks: [
            {
                link: 'https://tronsave.io/?ref=tcrq2fjvon5mphjg',
                text: 'Tron Save 能量 租赁',
                conversion: 'AW-16717420950/EGWHCNP6ttsZEJazvqM-'
            }
        ],
        social: [
            { platform: 'Telegram', link: 'https://t.me/BuyEnergyTronsave_bot?start=tcrq2fjvon5mphjg', label: 'Lending Bot', icon: 'bi-telegram' },
            { platform: 'Twitter', link: 'https://twitter.com/tronsave_io', icon: 'bi-twitter-x' },
            { platform: 'YouTube', link: 'https://www.youtube.com/@TronSaveOfficial', icon: 'bi-youtube' }
        ],
        addresses: [
            { address: 'TXUwRhntqX3kyALhtpC74JP8Nt6m2VMiYC', labels: ['authorize'] },
            { address: 'TWZEhq5JuUVvGtutNgnRBATbF8BnHGyn4S', labels: ['billing', 'payout'] }
        ],
        affiliateLink: 'https://tronsave.io/?ref=tcrq2fjvon5mphjg'
    },
    tronPulse: {
        endpoints: {
            liquidity: 'https://tronpulse.io/api/energypool/pool/liquidity',
            settings: 'https://tronpulse.io/api/energypool/market_settings',
            orders: 'https://tronpulse.io/api/energypool/order/market_orders'
        },
        siteLinks: [
            {
                link: 'https://tronpulse.io/r/tcrq2fjv',
                text: 'Tron Pulse',
                conversion: 'AW-16717420950/EGWHCNP6ttsZEJazvqM-'
            }
        ],
        social: [{ platform: 'Telegram', link: 'https://t.me/energypool', icon: 'bi-telegram' }],
        addresses: [
            { address: 'TBu4CN53XnwBPE93FNLnEsbMsqSs2Mw4kM', labels: ['authorize'] },
            { address: 'TH2uNFtnwr5NsiAW2Py6Fmv8zDhfYXyDd9', labels: ['billing', 'payout'] }
        ],
        affiliateLink: 'https://tronpulse.io/r/tcrq2fjv',
        minOrder: 32_000
    },
    ergon: {
        endpoints: {
            info: 'https://ergon.ustx.io/php/ergonGetInfo.php',
            pricing: 'https://ergon.ustx.io/php/ergonGetPrice.php'
        },
        siteLinks: [{ link: 'https://ergon.ustx.io', text: 'Ergon' }],
        social: [
            { platform: 'Telegram', link: 'https://t.me/ustx_en/', icon: 'bi-telegram' },
            { platform: 'Twitter', link: 'https://twitter.com/USTX6', icon: 'bi-twitter-x' },
            { platform: 'Discord', link: 'https://discord.gg/2stXZjtv9A', icon: 'bi-discord' },
            { platform: 'Reddit', link: 'https://www.reddit.com/r/USTX/', icon: 'bi-reddit' },
            { platform: 'YouTube', link: 'https://www.youtube.com/c/USTX-official', icon: 'bi-youtube' },
            { platform: 'LinkedIn', link: 'https://www.linkedin.com/company/ustx', icon: 'bi-linkedin' },
            { platform: 'Facebook', link: 'https://www.facebook.com/groups/ustxcrypto', icon: 'bi-facebook' },
            { platform: 'GitHub', link: 'https://github.com/ustx/ustx-dex/', icon: 'bi-github' }
        ],
        addresses: []
    },
    brutusFinance: {
        endpoints: {
            availability: 'https://e-bot.brutusservices.com/main/available',
            pricing: 'https://e-bot.brutusservices.com/main/prices/all'
        },
        siteLinks: [{ link: 'https://dapp.brutus.finance/?ebot', text: 'Brutus Finance' }],
        addresses: [{ address: 'T9yD14Nj9j7xAB4dbGeiX9h8unkKHxuWwb', labels: ['billing'] }]
    },
    meFreeNet: {
        endpoints: { info: 'https://mefree.net/gettron.jsp' },
        siteLinks: [{ link: 'https://mefree.net/en.jsp', text: 'MeFree.Net' }],
        addresses: [{ address: 'TUfAMQM81RLMdquBSaFytsXxEet7AKKKKK', labels: ['billing'] }]
    },
    tronFeeEnergyRental: {
        endpoints: { home: 'https://tofee.net' },
        siteLinks: [{ link: 'https://tofee.net', text: 'Tron Fee Energy Rental' }],
        social: [{ platform: 'Telegram', link: 'https://t.me/ToFeeEnergy', icon: 'bi-telegram' }],
        addresses: [
            { address: 'TCMrBZoSt3Q4egHzd7ga21JCdZH7n3EEEE', labels: ['billing'] },
            { address: 'TDUBmguVgMen8ZXZwAMvg47NXc4T6ToFee', labels: ['authorize'] }
        ]
    },
    tronify: {
        endpoints: {
            trades: 'https://open.tronify.io/api/tronRent/trades',
            pledgeConfig: 'https://open.tronify.io/api/tronRent/pledgeConfig'
        },
        siteLinks: [{ link: 'https://tronify.io', text: 'Tronify' }],
        social: [{ platform: 'Telegram', link: 'https://t.me/tronifyio', icon: 'bi-telegram' }],
        addresses: [
            { address: 'TXYqcWRnNP1bGsa9tzjsEJiKAYwMRonwMv', labels: ['billing'] },
            { address: 'TGVEVDZZHJGZAHEPfou57u8F89i5nNNRxX', labels: ['authorize'] }
        ]
    },
    tronLending: {
        endpoints: {
            info: 'https://axs.renttronenergy.com/resources/info',
            rate: 'https://axs.renttronenergy.com/price/rate',
            transactions: 'https://api.renttronenergy.com/transaction/get_transaction?page=1&txPerPage=10&option=DELEGATE'
        },
        siteLinks: [
            {
                link: 'https://tronlending.xyz/rent?referral=TCRq2FJVoN5mpHJgBR6KcavKWEYhQ45BrK',
                text: 'Tron Lending',
                conversion: 'AW-16717420950/EGWHCNP6ttsZEJazvqM-'
            }
        ],
        social: [{ platform: 'Telegram', link: 'https://t.me/tronenergylendingen', icon: 'bi-telegram' }],
        addresses: [{ address: 'TQ9KMdd6xkP8HqwmAL7dmT45YifyaAm6CZ', labels: ['authorize', 'payout'] }],
        affiliateLink: 'https://tronlending.xyz/rent?referral=TCRq2FJVoN5mpHJgBR6KcavKWEYhQ45BrK'
    },
    tronEnergize: {
        endpoints: { markets: 'https://tronenergize.com/tronenergize/api/markets' },
        siteLinks: [{ link: 'https://tronenergize.com', text: 'Tron Energize' }],
        social: [
            { platform: 'Telegram', link: 'https://t.me/TronEnergize', icon: 'bi-telegram' },
            { platform: 'Twitter', link: 'https://twitter.com/TronEnergize', icon: 'bi-twitter-x' },
            { platform: 'GitHub', link: 'https://github.com/Tronenergize', icon: 'bi-github' }
        ],
        addresses: [{ address: 'TLwpQv9N6uXZQeE4jUudLPjcRffbXXAuru', labels: ['billing'] }]
    },
    nitronEnergy: {
        endpoints: {
            info: 'https://nitronenergy.com/Home/GetTotalMultiSigNow',
            home: 'https://nitronenergy.com/',
            site: 'https://nitronenergy.com'
        },
        siteLinks: [{ link: 'https://nitronenergy.com', text: 'NiTron Energy' }],
        social: [
            { platform: 'Telegram', link: 'https://t.me/NiTronEnergy', icon: 'bi-telegram' },
            { platform: 'Telegram', link: 'https://t.me/+p17H3RMJRG85N2Jk', icon: 'bi-telegram-fill' },
            { platform: 'Twitter', link: 'https://twitter.com/NiTronEnergy', icon: 'bi-twitter-x' }
        ],
        addresses: [{ address: 'TKHgPuoqW4XNGJtwuFwExA7hcUdTkwcLXn', labels: ['billing', 'authorize'] }]
    },
    apiTrx: {
        endpoints: { price: 'https://apitrx.com/en/pages/price.html' },
        siteLinks: [{ link: 'https://apitrx.com/en/pages/other.html', text: 'Api TRX' }],
        social: [
            { platform: 'Telegram', link: 'https://t.me/apitrxbot', label: 'Bot', icon: 'bi-telegram' },
            { platform: 'Telegram', link: 'https://t.me/apitron', label: 'API Updates', icon: 'bi-telegram' }
        ],
        addresses: [{ address: 'TXLYbwws847CsHVetLPRYecyqE4s666666', labels: ['billing'] }]
    }
} satisfies Record<string, MarketProviderSettings>;

export const marketProviderConfig = {
    tronEnergyMarket: defaults.tronEnergyMarket,
    tronEnergy: defaults.tronEnergy,
    feeeIo: defaults.feeeIo,
    tronSave: defaults.tronSave,
    tronPulse: defaults.tronPulse,
    ergon: defaults.ergon,
    brutusFinance: defaults.brutusFinance,
    meFreeNet: defaults.meFreeNet,
    tronFeeEnergyRental: defaults.tronFeeEnergyRental,
    tronify: defaults.tronify,
    tronLending: defaults.tronLending,
    tronEnergize: defaults.tronEnergize,
    nitronEnergy: defaults.nitronEnergy,
    apiTrx: defaults.apiTrx
};
