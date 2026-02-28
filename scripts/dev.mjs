#!/usr/bin/env node

/**
 * Development server startup script.
 *
 * On standard platforms: Starts database containers (MongoDB, Redis, ClickHouse),
 * waits for them to be healthy, then runs backend and frontend in the foreground.
 *
 * On Termux/Android: Starts native MongoDB and Redis (no Docker), then runs
 * backend and frontend with process management.
 *
 * Ctrl+C stops the dev servers; on standard platforms containers keep running
 * for fast restarts.
 */

import { spawn, execSync, spawnSync } from 'child_process';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'net';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');

/**
 * Runs plugin registry generators.
 *
 * Generates static import registries for both backend and frontend plugins.
 * This enables on-the-fly TypeScript compilation during development while
 * keeping the core loaders unaware of specific plugin paths.
 */
async function generatePluginRegistries() {
    log('info', 'Generating plugin registries...');

    try {
        // Generate backend plugin registry
        execSync('node scripts/generate-backend-plugin-registry.mjs', {
            cwd: PROJECT_ROOT,
            stdio: 'inherit',
        });

        // Generate frontend plugin registry
        execSync('node scripts/generate-frontend-plugin-registry.mjs', {
            cwd: PROJECT_ROOT,
            stdio: 'inherit',
        });

        log('success', 'Plugin registries generated');
    } catch (error) {
        log('error', 'Failed to generate plugin registries');
        throw error;
    }
}

const COMPOSE_FILE = 'docker-compose.npm.yml';
const CONTAINERS = ['tronrelic-mongo', 'tronrelic-redis', 'tronrelic-clickhouse'];
const HEALTH_CHECK_TIMEOUT_MS = 60000;
const HEALTH_CHECK_INTERVAL_MS = 2000;

/**
 * Detects if running in Termux/Android environment.
 *
 * Termux is a terminal emulator for Android that provides a Linux environment.
 * Docker is not available on Termux, so we use native MongoDB and Redis instead.
 *
 * @returns {boolean} True if running on Termux/Android
 */
function isTermux() {
    try {
        const uname = execSync('uname -o 2>/dev/null', { encoding: 'utf8' }).trim();
        if (uname === 'Android') return true;
    } catch {
        // uname -o not supported
    }
    return existsSync('/data/data/com.termux');
}

/**
 * Logs a message with colored prefix.
 *
 * @param {string} level - Log level (info, success, warn, error)
 * @param {string} message - Message to log
 */
function log(level, message) {
    const colors = {
        info: '\x1b[1;34m',
        success: '\x1b[1;32m',
        warn: '\x1b[1;33m',
        error: '\x1b[1;31m',
    };
    const reset = '\x1b[0m';
    const color = colors[level] || '';
    const label = level.toUpperCase();
    console.log(`${color}[${label}]${reset} ${message}`);
}

/**
 * Executes a command and returns stdout, or null on failure.
 *
 * @param {string} cmd - Command to execute
 * @returns {string|null} Command output or null on failure
 */
function exec(cmd) {
    try {
        return execSync(cmd, { encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }).trim();
    } catch {
        return null;
    }
}

/**
 * Checks if a TCP port is accepting connections.
 *
 * @param {number} port - Port number to check
 * @param {string} host - Host to connect to
 * @returns {Promise<boolean>} True if port is accepting connections
 */
function checkPort(port, host = '127.0.0.1') {
    return new Promise((resolve) => {
        const socket = createServer();
        socket.once('error', () => resolve(true)); // Port in use = service running
        socket.once('listening', () => {
            socket.close();
            resolve(false); // Port available = service not running
        });
        socket.listen(port, host);
    });
}

/**
 * Waits for a port to become available with timeout.
 *
 * @param {number} port - Port to wait for
 * @param {string} serviceName - Name of service for logging
 * @param {number} timeoutMs - Timeout in milliseconds
 * @returns {Promise<boolean>} True if service started, false on timeout
 */
async function waitForPort(port, serviceName, timeoutMs = 60000) {
    const startTime = Date.now();
    let attempts = 0;

    while (Date.now() - startTime < timeoutMs) {
        const isUp = await checkPort(port);
        if (isUp) {
            log('success', `${serviceName} is ready on port ${port}`);
            return true;
        }

        attempts++;
        if (attempts % 5 === 0) {
            const elapsed = Math.round((Date.now() - startTime) / 1000);
            process.stdout.write(`\r  Waiting for ${serviceName}... (${elapsed}s)    `);
        }

        await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    console.log('');
    log('error', `Timeout waiting for ${serviceName} on port ${port}`);
    return false;
}

/**
 * Checks if Docker is available and running.
 */
function checkDocker() {
    const result = exec('docker info');
    if (!result) {
        log('error', 'Docker is not running. Please start Docker and try again.');
        process.exit(1);
    }
}

/**
 * Checks if .env file exists.
 */
function checkEnvFile() {
    const envPath = join(PROJECT_ROOT, '.env');
    if (!existsSync(envPath)) {
        log('error', 'Missing .env file. Copy .env.example to .env and configure it.');
        process.exit(1);
    }
}

/**
 * Starts database containers via Docker Compose.
 */
function startContainers() {
    log('info', 'Starting database containers...');
    try {
        execSync(`docker-compose -f ${COMPOSE_FILE} up -d`, {
            cwd: PROJECT_ROOT,
            stdio: 'inherit',
        });
    } catch (error) {
        log('error', 'Failed to start containers');
        process.exit(1);
    }
}

/**
 * Gets the health status of a Docker container.
 *
 * @param {string} container - Container name
 * @returns {string} Health status
 */
function getContainerHealth(container) {
    const result = exec(`docker inspect --format='{{.State.Health.Status}}' ${container}`);
    return result || 'unknown';
}

/**
 * Waits for all Docker containers to be healthy.
 */
async function waitForHealthy() {
    log('info', 'Waiting for containers to be healthy...');
    const startTime = Date.now();

    while (Date.now() - startTime < HEALTH_CHECK_TIMEOUT_MS) {
        const statuses = CONTAINERS.map((c) => ({ name: c, status: getContainerHealth(c) }));
        const allHealthy = statuses.every((s) => s.status === 'healthy');

        if (allHealthy) {
            log('success', 'All containers are healthy');
            return;
        }

        const statusStr = statuses.map((s) => `${s.name.replace('tronrelic-', '')}: ${s.status}`).join(', ');
        process.stdout.write(`\r  ${statusStr}    `);

        await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
    }

    console.log('');
    log('error', 'Timeout waiting for containers to be healthy');
    process.exit(1);
}

/**
 * Runs the dev servers in the foreground using concurrently.
 */
function runDevServers() {
    log('info', 'Starting dev servers...');
    console.log('');

    const cmd = 'npx concurrently --kill-others -n backend,frontend -c blue,magenta "npm run dev:backend" "npm run dev:frontend"';
    const child = spawn(cmd, {
        cwd: PROJECT_ROOT,
        stdio: 'inherit',
        shell: true,
        env: { ...process.env, FORCE_COLOR: '1' },
    });

    child.on('exit', (code) => {
        process.exit(code || 0);
    });
}

// =============================================================================
// Termux/Android Support
// =============================================================================

/**
 * Kills any process listening on the specified port.
 *
 * @param {number} port - Port number to free
 */
function killPort(port) {
    try {
        // Use fuser which reliably finds port owners on Linux/WSL2.
        // lsof can miss processes in some WSL2 configurations.
        const result = exec(`fuser ${port}/tcp`);
        if (result) {
            const pids = result.trim().split(/\s+/).filter(Boolean);
            for (const pid of pids) {
                try {
                    execSync(`kill -9 ${pid.trim()}`, { stdio: 'pipe' });
                } catch {
                    // Process may have already exited
                }
            }
            log('warn', `Killed orphaned process(es) on port ${port}: ${pids.join(', ')}`);
        }
    } catch {
        // fuser not available or no process on port
    }
}

/**
 * Starts MongoDB natively for Termux (no Docker).
 *
 * @param {string} runDir - Directory for logs and PIDs
 * @param {string} dataDir - Directory for MongoDB data
 * @returns {number} MongoDB process PID
 */
function startTermuxMongoDB(runDir, dataDir) {
    mkdirSync(dataDir, { recursive: true });

    log('info', 'Starting MongoDB (native)...');

    // Kill any existing MongoDB on this data directory
    exec(`pkill -f "mongod.*${dataDir}"`) || true;
    killPort(27017);

    const logFile = join(runDir, 'mongodb.log');
    const child = spawn('mongod', ['--dbpath', dataDir, '--bind_ip', '127.0.0.1', '--port', '27017'], {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Write logs to file
    const logStream = require('fs').createWriteStream(logFile);
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.unref();

    writeFileSync(join(runDir, 'mongodb.pid'), String(child.pid));
    log('info', `MongoDB PID: ${child.pid} (logs: ${logFile})`);

    return child.pid;
}

/**
 * Starts Redis natively for Termux (no Docker).
 *
 * @param {string} runDir - Directory for logs and PIDs
 * @returns {number} Redis process PID
 */
function startTermuxRedis(runDir) {
    log('info', 'Starting Redis (native)...');

    // Kill any existing Redis
    exec('pkill -f "redis-server.*6379"') || true;
    killPort(6379);

    const logFile = join(runDir, 'redis.log');

    // --ignore-warnings ARM64-COW-BUG suppresses kernel bug warning on Android ARM64
    const child = spawn('redis-server', ['--bind', '127.0.0.1', '--port', '6379', '--daemonize', 'no', '--ignore-warnings', 'ARM64-COW-BUG'], {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
    });

    // Write logs to file
    const logStream = require('fs').createWriteStream(logFile);
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    child.unref();

    writeFileSync(join(runDir, 'redis.pid'), String(child.pid));
    log('info', `Redis PID: ${child.pid} (logs: ${logFile})`);

    return child.pid;
}

/**
 * Starts the backend server for Termux.
 *
 * @param {string} runDir - Directory for logs and PIDs
 * @returns {object} Child process
 */
function startTermuxBackend(runDir) {
    log('info', 'Starting backend...');

    const logFile = join(runDir, 'backend.log');
    const child = spawn('npm', ['run', 'dev:backend'], {
        cwd: PROJECT_ROOT,
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env, DOTENV_CONFIG_PATH: join(PROJECT_ROOT, '.env') },
    });

    const logStream = require('fs').createWriteStream(logFile);
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    writeFileSync(join(runDir, 'backend.pid'), String(child.pid));
    log('info', `Backend PID: ${child.pid} (logs: ${logFile})`);

    return child;
}

/**
 * Starts the frontend server for Termux.
 * Note: Turbopack (--turbo flag) doesn't work on Android/WASM.
 *
 * @param {string} runDir - Directory for logs and PIDs
 * @returns {object} Child process
 */
function startTermuxFrontend(runDir) {
    log('info', 'Starting frontend...');

    const logFile = join(runDir, 'frontend.log');

    // Run next dev directly without turbo flag (not supported on Android)
    const child = spawn('npx', ['next', 'dev', '--port', '3000'], {
        cwd: join(PROJECT_ROOT, 'src', 'frontend'),
        detached: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
    });

    const logStream = require('fs').createWriteStream(logFile);
    child.stdout.pipe(logStream);
    child.stderr.pipe(logStream);

    writeFileSync(join(runDir, 'frontend.pid'), String(child.pid));
    log('info', `Frontend PID: ${child.pid} (logs: ${logFile})`);

    return child;
}

/**
 * Main entry point for Termux mode.
 * Runs MongoDB and Redis natively without Docker.
 */
async function mainTermux() {
    console.log('');
    log('info', 'TronRelic Development Server (Termux Mode)');
    log('info', 'Using native MongoDB and Redis (no Docker)');
    console.log('');

    checkEnvFile();

    // Create directories for runtime files
    const runDir = join(PROJECT_ROOT, '.run');
    const mongoDataDir = join(PROJECT_ROOT, '.mongodb');
    mkdirSync(runDir, { recursive: true });

    // Start native services
    startTermuxMongoDB(runDir, mongoDataDir);
    startTermuxRedis(runDir);

    // Wait for MongoDB
    if (!(await waitForPort(27017, 'MongoDB'))) {
        log('error', 'MongoDB failed to start. Check .run/mongodb.log');
        process.exit(1);
    }

    // Wait for Redis
    if (!(await waitForPort(6379, 'Redis'))) {
        log('error', 'Redis failed to start. Check .run/redis.log');
        process.exit(1);
    }

    // Generate plugin registries before starting dev servers
    await generatePluginRegistries();

    // Start application servers
    const backendProc = startTermuxBackend(runDir);
    const frontendProc = startTermuxFrontend(runDir);

    // Wait for backend
    if (!(await waitForPort(4000, 'Backend', 120000))) {
        log('error', 'Backend failed to start. Check .run/backend.log');
        process.exit(1);
    }

    // Wait for frontend
    if (!(await waitForPort(3000, 'Frontend', 120000))) {
        log('error', 'Frontend failed to start. Check .run/frontend.log');
        process.exit(1);
    }

    console.log('');
    log('success', '=========================================');
    log('success', 'TronRelic is now running! (Termux)');
    log('success', '=========================================');
    console.log('');
    log('success', 'Frontend: http://localhost:3000');
    log('success', 'Backend:  http://localhost:4000');
    console.log('');
    log('info', 'Logs:');
    log('info', '  Backend:  tail -f .run/backend.log');
    log('info', '  Frontend: tail -f .run/frontend.log');
    log('info', '  MongoDB:  tail -f .run/mongodb.log');
    log('info', '  Redis:    tail -f .run/redis.log');
    console.log('');
    log('info', 'Stop: npm run stop:termux');
    log('success', '=========================================');

    // Try to open browser on Termux
    exec('termux-open-url http://localhost:3000') || exec('xdg-open http://localhost:3000');

    // Keep process alive to maintain logs
    process.on('SIGINT', () => {
        log('info', 'Shutting down...');
        log('info', 'Run "npm run stop:termux" to stop all services');
        process.exit(0);
    });

    // Wait indefinitely
    await new Promise(() => {});
}

/**
 * Main entry point for standard mode (Docker).
 */
async function mainDocker() {
    console.log('');
    log('info', 'TronRelic Development Server');
    console.log('');

    checkDocker();
    checkEnvFile();
    startContainers();
    await waitForHealthy();

    // Kill any zombie processes from a prior dev run before starting.
    // On WSL2, SIGTERM from concurrently --kill-others doesn't always
    // propagate through npm subprocess wrappers, leaving orphaned Next.js
    // or backend processes holding ports across restarts.
    killPort(3000);
    killPort(4000);

    // Generate plugin registries before starting dev servers.
    // Generated files are excluded from tsx watch via --ignore flags in
    // the dev:backend script to prevent false-positive restarts.
    await generatePluginRegistries();

    console.log('');
    log('success', 'Backend:  http://localhost:4000');
    log('success', 'Frontend: http://localhost:3000');
    console.log('');
    log('info', 'Press Ctrl+C to stop dev servers');
    log('info', 'Run "npm run stop" to stop database containers');
    console.log('');

    runDevServers();
}

/**
 * Main entry point - detects environment and runs appropriate mode.
 */
async function main() {
    if (isTermux()) {
        await mainTermux();
    } else {
        await mainDocker();
    }
}

main();
