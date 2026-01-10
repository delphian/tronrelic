#!/usr/bin/env node
/**
 * @fileoverview Backend build script using esbuild.
 *
 * Bundles the backend application with path alias resolution. External
 * dependencies (express, mongoose, etc.) are not bundled to keep the
 * output lean and allow native modules to work correctly.
 */

import * as esbuild from 'esbuild';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

await esbuild.build({
    entryPoints: [path.join(projectRoot, 'src/backend/index.ts')],
    bundle: true,
    platform: 'node',
    target: 'node20',
    format: 'esm',
    outfile: path.join(projectRoot, 'dist/backend/index.js'),
    sourcemap: true,
    external: [
        // Keep all node_modules external - they'll be installed via npm ci
        './node_modules/*',
        '../node_modules/*',
        '*.node',
    ],
    packages: 'external',
    alias: {
        '@/types': path.join(projectRoot, 'src/types'),
        '@/shared': path.join(projectRoot, 'src/shared'),
        '@/backend': path.join(projectRoot, 'src/backend'),
        '@/frontend': path.join(projectRoot, 'src/frontend'),
        '@/plugins': path.join(projectRoot, 'src/plugins'),
    },
});

console.log('Backend build complete: dist/backend/index.js');
