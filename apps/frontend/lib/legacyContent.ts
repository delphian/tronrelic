const NETWORK_LATENCY = 260;

function delay(duration = NETWORK_LATENCY) {
  return new Promise(resolve => {
    setTimeout(resolve, duration);
  });
}

export interface LegacyArticle {
  slug: string;
  title: string;
  excerpt: string;
  href: string;
  updatedAt: string;
  readingTimeMinutes: number;
  category: 'Guides' | 'Research' | 'Ecosystem';
  tags: string[];
  featured?: boolean;
}

export interface LegacyTool {
  slug: string;
  title: string;
  description: string;
  href: string;
  categories: ('Energy' | 'Analytics' | 'Delegation' | 'Security')[];
  latencyMs?: number;
  availability?: 'preview' | 'stable';
}

export interface LegacyForumSpace {
  slug: string;
  title: string;
  description: string;
  href: string;
  memberCount: number;
  topicCount: number;
  lastActiveAt: string;
  moderationLevel: 'open' | 'curated';
  pinned?: boolean;
}

const legacyArticles: LegacyArticle[] = [
  {
    slug: 'tron-node-setup-guide',
    title: 'TRON Node Setup Guide',
    excerpt: 'Deploy a performant TRON full node with modern observability, failover, and resource tuning recommendations.',
    href: '/tron-node-setup-guide',
    updatedAt: '2025-03-11T00:00:00.000Z',
    readingTimeMinutes: 14,
    category: 'Guides',
    tags: ['Infrastructure', 'Nodes', 'Best Practices'],
    featured: true
  },
  {
    slug: 'tron-delegated-proof-of-stake',
    title: 'Understanding TRON Delegated Proof of Stake',
    excerpt: 'Deep dive into validator rotations, voting weight distribution, and super representative incentives post-2024 hard fork.',
    href: '/tron-delegated-proof-of-stake',
    updatedAt: '2025-02-02T00:00:00.000Z',
    readingTimeMinutes: 11,
    category: 'Research',
    tags: ['Governance', 'Super Representatives']
  },
  {
    slug: 'tron-bandwidth-vs-energy',
    title: 'Bandwidth vs. Energy on TRON',
    excerpt: 'Compare TRON resource costs, pooling strategies, and hybrid delegation plans for large-scale DeFi workloads.',
    href: '/tron-bandwidth-vs-energy',
    updatedAt: '2025-01-25T00:00:00.000Z',
    readingTimeMinutes: 9,
    category: 'Guides',
    tags: ['Resources', 'DeFi']
  },
  {
    slug: 'tron-trx-mining',
    title: 'TRX Mining Landscape in 2025',
    excerpt: 'Evaluate proof-of-stake yield strategies, staking-as-a-service providers, and expected APY bands for TRX.',
    href: '/tron-trx-mining',
    updatedAt: '2024-12-14T00:00:00.000Z',
    readingTimeMinutes: 8,
    category: 'Ecosystem',
    tags: ['Yield', 'Market Data']
  },
  {
    slug: 'tron-super-representatives',
    title: 'Super Representatives & Committees',
    excerpt: 'Track committee participation, uptime, and policy proposals across the TRON super representative set.',
    href: '/tron-super-representatives',
    updatedAt: '2024-11-30T00:00:00.000Z',
    readingTimeMinutes: 10,
    category: 'Research',
    tags: ['Super Representatives', 'Policy'],
    featured: true
  },
  {
    slug: 'tron-latest-trc10-tokens',
    title: 'Latest TRC10 Token Launches',
    excerpt: 'Monitor new TRC10 launches, volumes, and liquidity readiness with context on contract verifications.',
    href: '/tron-latest-trc10-tokens',
    updatedAt: '2024-10-05T00:00:00.000Z',
    readingTimeMinutes: 6,
    category: 'Ecosystem',
    tags: ['Tokens', 'Launches']
  }
];

const legacyTools: LegacyTool[] = [
  {
    slug: 'tron-energy-estimator',
    title: 'TRX Energy Estimator',
    description: 'Predict energy burn for contract interactions, including memo-heavy transfers and SunPump swaps.',
    href: '/tools/energy-estimator',
    categories: ['Energy', 'Analytics'],
    latencyMs: 320,
    availability: 'stable'
  },
  {
    slug: 'tron-account-analytics',
    title: 'Account Analytics Sandbox',
    description: 'Replay historic inflow/outflow scenarios, model delegation churn, and export CSVs for compliance.',
    href: '/tools/account-analytics',
    categories: ['Analytics'],
    latencyMs: 410,
    availability: 'preview'
  },
  {
    slug: 'tron-delegation-planner',
    title: 'Delegation Planner',
    description: 'Build optimized resource rental plans with blended rates, auto-renew windows, and affiliate attribution.',
    href: '/tools/delegation-planner',
    categories: ['Delegation', 'Energy'],
    latencyMs: 270,
    availability: 'stable'
  },
  {
    slug: 'tron-signature-workbench',
    title: 'Signature Workbench',
    description: 'Verify TronLink signatures, inspect payload hashes, and debug wallet auth flows for comments & chat.',
    href: '/tools/signature-workbench',
    categories: ['Security'],
    latencyMs: 180,
    availability: 'stable'
  }
];

const legacyForumSpaces: LegacyForumSpace[] = [
  {
    slug: 'network-operations',
    title: 'Network Operations',
    description: 'Signed updates from infrastructure maintainers covering node upgrades, RPC incidents, and release notes.',
    href: '/forum/network-operations',
    memberCount: 1824,
    topicCount: 264,
    lastActiveAt: '2025-03-18T12:30:00.000Z',
    moderationLevel: 'curated',
    pinned: true
  },
  {
    slug: 'energy-market-desk',
    title: 'Energy Market Desk',
    description: 'Price discovery, rental desk comparisons, and execution quality reports for resource marketplaces.',
    href: '/forum/energy-market-desk',
    memberCount: 2312,
    topicCount: 493,
    lastActiveAt: '2025-03-19T08:05:00.000Z',
    moderationLevel: 'open'
  },
  {
    slug: 'builders-lounge',
    title: 'Builders Lounge',
    description: 'Smart contract audit checklists, SDK updates, and DX Q&A for TRON ecosystem engineers.',
    href: '/forum/builders-lounge',
    memberCount: 1579,
    topicCount: 341,
    lastActiveAt: '2025-03-17T22:15:00.000Z',
    moderationLevel: 'curated'
  },
  {
    slug: 'wallet-feedback',
    title: 'Wallet Feedback',
    description: 'Community triage for wallet UX issues, TronLink troubleshooting, and improvement proposals.',
    href: '/forum/wallet-feedback',
    memberCount: 924,
    topicCount: 118,
    lastActiveAt: '2025-03-16T15:02:00.000Z',
    moderationLevel: 'open'
  }
];

export async function fetchLegacyArticles(): Promise<LegacyArticle[]> {
  await delay();
  return legacyArticles;
}

export async function fetchLegacyTools(): Promise<LegacyTool[]> {
  await delay();
  return legacyTools;
}

export async function fetchLegacyForumSpaces(): Promise<LegacyForumSpace[]> {
  await delay();
  return legacyForumSpaces;
}

export async function toggleLegacyArticleSave(slug: string, saved: boolean) {
  await delay(180);
  return { slug, saved };
}

export async function toggleLegacyToolFavorite(slug: string, favorite: boolean) {
  await delay(180);
  return { slug, favorite };
}

export async function toggleLegacyForumSubscription(slug: string, subscribed: boolean) {
  await delay(200);
  return { slug, subscribed };
}
