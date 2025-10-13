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
                destination: `${process.env.API_URL || 'http://localhost:4000'}/api/:path*`,
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
                source: '/rent-tron-energy',
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
