/**
 * @fileoverview The public tool pages this module serves, in one list.
 *
 * The Tools menu and the sitemap both read this list, so a tool added here gets
 * its menu entry and its sitemap entry together, and a tool removed here leaves
 * both. Each `url` must either match a route under
 * `src/frontend/app/[lang]/(site)/(core)/tools/`, or belong to a CMS page the
 * module offers on its Bootstrap tab and be marked `cmsPage`.
 */

/** One tool page: its menu entry and the address it is served at. */
interface IToolPage {
    /** Menu label, also the card title on the `/tools` landing page. */
    label: string;
    /** Root-relative address of the tool's page. */
    url: string;
    /** Lucide icon name for the menu entry. */
    icon: string;
    /** Sort position among the Tools menu's children. */
    order: number;
    /** One-sentence summary shown on the menu entry and the landing page card. */
    description: string;
    /**
     * True when no route in code serves the address and a CMS page owns it.
     * The pages module lists a published CMS page in the sitemap under its
     * current address, so the module leaves these out of its own entries; an
     * address with no page yet answers 404 and must not be listed.
     */
    cmsPage?: boolean;
}

/** Address of the Tools category landing page, derived by the menu from the container's label. */
export const TOOLS_CATEGORY_PATH = '/tools';

/** Every tool page, in menu order. */
export const TOOL_PAGES: ReadonlyArray<IToolPage> = [
    { label: 'Address Converter', url: '/tools/address-converter', icon: 'ArrowLeftRight', order: 10, description: 'Convert a TRON address between its Base58 form (starting with T) and its hex form (starting with 41).', cmsPage: true },
    { label: 'Address Generator', url: '/tools/address-generator', icon: 'KeyRound', order: 15, description: 'Create a new TRON wallet with a recovery phrase, or search for a vanity address. Everything runs in your browser, so keys never leave your device.', cmsPage: true },
    { label: 'Energy Estimator', url: '/tools/energy-estimator', icon: 'Zap', order: 20, description: 'Estimate how much energy your smart contract calls need each day, and compare staking TRX for it with burning TRX to pay the fees.', cmsPage: true },
    { label: 'Stake Calculator', url: '/tools/stake-calculator', icon: 'Calculator', order: 30, description: 'See how much energy and bandwidth a TRX stake gives you, or how much TRX to stake for the energy you need, at live network rates.', cmsPage: true },
    { label: 'Staking Rewards', url: '/tools/staking-rewards', icon: 'Coins', order: 35, description: 'Estimate the TRX you earn each year by voting with staked TRX, and compare every Super Representative by commission and reward rate.', cmsPage: true },
    { label: 'Signature Verifier', url: '/tools/signature-verifier', icon: 'ShieldCheck', order: 40, description: 'Check whether a TRON wallet signed a message, to confirm who controls an address. A link carrying the wallet, message, and signature verifies on load.' },
    { label: 'Approval Checker', url: '/tools/approval-checker', icon: 'Shield', order: 45, description: 'Scan a TRON wallet\'s recent TRC20 token approvals for unlimited allowances, and see which contracts can spend its tokens.' },
    { label: 'Address Origins', url: '/tools/address-origins', icon: 'GitBranch', order: 48, description: 'Trace a TRON wallet back through the accounts that activated it to find where it came from, and spot ancestors shared by several wallets.' },
    { label: 'Timestamp Converter', url: '/tools/timestamp-converter', icon: 'Clock', order: 50, description: 'Convert between Unix timestamps, calendar dates, and TRON block numbers, in either direction.', cmsPage: true }
];
