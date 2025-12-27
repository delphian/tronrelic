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
 * Requires SITE_BACKEND environment variable:
 * - Docker: http://backend:4000 for container-to-container communication
 * - Local npm: http://localhost:4000 for local development
 *
 * The rewrite rule converts client-side /api/* requests into backend API calls:
 * - Browser requests /api/markets → Next.js rewrites to configured SITE_BACKEND/api/markets
 *
 * @returns {string} Backend origin without a trailing slash
 */
function resolveInternalApiOrigin() {
    if (!process.env.SITE_BACKEND) {
        throw new Error('SITE_BACKEND environment variable is required for API rewrites');
    }
    return process.env.SITE_BACKEND.replace(/\/$/, '');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
    output: 'standalone',
    sassOptions: {
        includePaths: [join(__dirname, 'app')],
    },
    compiler: {
        removeConsole: process.env.NODE_ENV === 'production'
            ? { exclude: ['error', 'warn'] }
            : false,
    },
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

        // Extend Next.js SCSS module rules to include plugin directories.
        //
        // transpilePackages handles JS/TS transpilation for plugins, but SCSS files
        // go through a separate webpack pipeline (css-loader + sass-loader) that has
        // its own include patterns scoped to the app directory. Without this fix,
        // plugin .scss files bypass sass-loader entirely and are served as raw text.
        //
        // This finds existing SCSS module rules and:
        // 1. Extends their include pattern to cover packages/plugins/
        // 2. Adds apps/frontend/app/ to sass includePaths for @import resolution
        config.module.rules.forEach(rule => {
            if (rule.oneOf) {
                rule.oneOf.forEach(oneOfRule => {
                    // Find rules that handle .module.scss files
                    const isScssModuleRule = oneOfRule.test instanceof RegExp &&
                        oneOfRule.test.test('example.module.scss');
                    if (isScssModuleRule) {
                        const originalInclude = oneOfRule.include;
                        oneOfRule.include = (resourcePath) => {
                            // Include plugin SCSS files
                            if (resourcePath.includes('/packages/plugins/')) {
                                return true;
                            }
                            // Preserve original behavior for app SCSS files
                            if (typeof originalInclude === 'function') {
                                return originalInclude(resourcePath);
                            }
                            if (originalInclude instanceof RegExp) {
                                return originalInclude.test(resourcePath);
                            }
                            return true;
                        };

                        if (oneOfRule.use && Array.isArray(oneOfRule.use)) {
                            oneOfRule.use.forEach(loader => {
                                if (loader.loader && loader.loader.includes('sass-loader')) {
                                    loader.options = loader.options || {};
                                    loader.options.sassOptions = loader.options.sassOptions || {};
                                    loader.options.sassOptions.includePaths = [
                                        ...(loader.options.sassOptions.includePaths || []),
                                        join(__dirname, 'app')
                                    ];
                                }
                            });
                        }
                    }
                });
            }
        });

        return config;
    },
    experimental: {
        externalDir: true,
        webpackBuildWorker: true,
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
            {
                source: '/uploads/:path*',
                destination: `${resolveInternalApiOrigin()}/uploads/:path*`,
            },
        ];
    },
    async headers() {
        return [
            {
                source: '/images/:path*',
                headers: [
                    {
                        key: 'Cache-Control',
                        value: 'public, max-age=2592000, stale-while-revalidate=86400',
                    },
                ],
            },
        ];
    },
    // Redirects moved to middleware.ts for referrer preservation
};

export default nextConfig;
