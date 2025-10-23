import { readdirSync, readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = join(__dirname, '..', '..');
const pluginsRoot = join(repoRoot, 'packages', 'plugins');

/**
 * Discovers plugin package names for Next.js transpilation.
 *
 * It inspects each plugin directory and reads its package manifest to capture the published package name. This lets Next compile workspace plugins without manually updating the config.
 */
function discoverPluginPackages() {
    try {
        const entries = readdirSync(pluginsRoot, { withFileTypes: true });
        return entries
            .filter(entry => entry.isDirectory())
            .flatMap(entry => {
                if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === 'dist') {
                    return [];
                }

                const packageJsonPath = join(pluginsRoot, entry.name, 'package.json');

                try {
                    const manifest = JSON.parse(readFileSync(packageJsonPath, 'utf8'));
                    return manifest.name ? [manifest.name] : [];
                } catch {
                    return [];
                }
            });
    } catch (error) {
        console.warn('Failed to read plugin packages for Next.js transpilation.', error);
        return [];
    }
}

const pluginPackages = discoverPluginPackages();

/**
 * Resolves the backend origin for server-side rewrites.
 *
 * Why this matters:
 * - Docker mode: Uses API_URL=http://backend:4000 for container-to-container communication
 * - npm mode: Falls back to NEXT_PUBLIC_API_URL or localhost:4000 for local development
 * - This mirrors getBackendBaseUrl() in lib/config.ts to keep rewrites aligned with SSR fetch calls
 *
 * The rewrite rule converts client-side /api/* requests into backend API calls:
 * - Browser requests /api/markets → Next.js rewrites to http://localhost:4000/api/markets (npm mode)
 * - Browser requests /api/markets → Next.js rewrites to http://backend:4000/api/markets (Docker mode)
 *
 * @returns {string} Backend origin without a trailing slash
 */
function resolveInternalApiOrigin() {
    // Docker mode: Use internal service name
    if (process.env.API_URL) {
        return process.env.API_URL.replace(/\/$/, '');
    }

    // npm mode: Use public API URL (works for localhost)
    if (process.env.NEXT_PUBLIC_API_URL) {
        return process.env.NEXT_PUBLIC_API_URL.replace(/\/api$/, '').replace(/\/$/, '');
    }

    // Fallback for npm mode when .env isn't loaded
    return 'http://localhost:4000';
}

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    swcMinify: true,
    typescript: {
        ignoreBuildErrors: true,
    },
    eslint: {
        ignoreDuringBuilds: true,
    },
    transpilePackages: ['@tronrelic/types', ...pluginPackages],
    webpack: (config, { isServer }) => {
        config.resolve = config.resolve || {};
        config.resolve.alias = {
            ...config.resolve.alias,
            '@tronrelic/plugins/loader$': false,
            '@tronrelic/plugins/loader-frontend$': false,
        };

        if (!isServer) {
            config.watchOptions = {
                ...config.watchOptions,
                ignored: ['**/node_modules', '**/.git'],
            };
        }

        return config;
    },
    experimental: {
        externalDir: true,
        webpackBuildWorker: true,
        turbotrace: {
            logLevel: 'error',
        },
    },
    images: {
        remotePatterns: [
            {
                protocol: 'https',
                hostname: '**',
            },
        ],
    },
    async rewrites() {
        return [
            {
                source: '/api/:path*',
                destination: `${resolveInternalApiOrigin()}/api/:path*`,
            },
        ];
    },
    async redirects() {
        const legacyToolPaths = [
            '/tron-trx-energy-fee-calculator',
            '/tools/staking-calculator',
            '/tools/tronmoji',
            '/tools/tron-custom-address-generator',
            '/tools/signature-verification',
            '/tools/hex-to-base58check',
            '/tools/base58check-to-hex',
        ];

        const legacyArticleSlugs = [
            '/tron-dex',
            '/tron-latest-trc10-tokens',
            '/tron-latest-trc10-exchanges',
            '/tron-node-setup-guide',
            '/tron-bandwidth-vs-energy',
            '/tron-delegated-proof-of-stake',
            '/tron-trc10-token',
            '/tron-super-representatives',
        ];

        return [
            {
                source: '/rent-tron-energy/:path*',
                destination: '/resource-markets',
                permanent: true,
            },
            {
                source: '/lp/rm/:path*',
                destination: '/resource-markets',
                permanent: true,
            },
            ...legacyToolPaths.map(path => ({
                source: `${path}`,
                destination: '/tools',
                permanent: true,
            })),
            ...legacyToolPaths.map(path => ({
                source: `${path}/:path*`,
                destination: '/tools',
                permanent: true,
            })),
            ...legacyArticleSlugs.map(path => ({
                source: `${path}`,
                destination: '/articles',
                permanent: true,
            })),
            ...legacyArticleSlugs.map(path => ({
                source: `${path}/:path*`,
                destination: '/articles',
                permanent: true,
            })),
        ];
    },
};

export default nextConfig;
