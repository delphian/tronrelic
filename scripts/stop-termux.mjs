#!/usr/bin/env node

/**
 * Stop script for Termux/Android development environment.
 *
 * Reads PID files from .run/ directory and terminates all TronRelic services
 * (MongoDB, Redis, backend, frontend) that were started by dev.mjs in Termux mode.
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync, readdirSync, unlinkSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = join(__dirname, '..');
const RUN_DIR = join(PROJECT_ROOT, '.run');

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
 * Kills a process by PID.
 *
 * @param {number} pid - Process ID to kill
 * @param {string} name - Service name for logging
 * @returns {boolean} True if process was killed
 */
function killProcess(pid, name) {
    try {
        process.kill(pid, 'SIGTERM');
        log('success', `Stopped ${name} (PID: ${pid})`);
        return true;
    } catch (err) {
        if (err.code === 'ESRCH') {
            log('warn', `${name} (PID: ${pid}) was not running`);
        } else {
            log('error', `Failed to stop ${name}: ${err.message}`);
        }
        return false;
    }
}

/**
 * Stops a service by reading its PID file.
 *
 * @param {string} serviceName - Name of the service (mongodb, redis, backend, frontend)
 */
function stopService(serviceName) {
    const pidFile = join(RUN_DIR, `${serviceName}.pid`);

    if (!existsSync(pidFile)) {
        log('warn', `No PID file found for ${serviceName}`);
        return;
    }

    try {
        const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
        if (isNaN(pid)) {
            log('error', `Invalid PID in ${pidFile}`);
            return;
        }

        killProcess(pid, serviceName);
        unlinkSync(pidFile);
    } catch (err) {
        log('error', `Failed to read PID file for ${serviceName}: ${err.message}`);
    }
}

/**
 * Kills any remaining processes on standard ports.
 */
function cleanupPorts() {
    const ports = [
        { port: 3000, name: 'frontend' },
        { port: 4000, name: 'backend' },
        { port: 27017, name: 'mongodb' },
        { port: 6379, name: 'redis' },
    ];

    for (const { port, name } of ports) {
        try {
            const result = execSync(`lsof -ti:${port} 2>/dev/null`, { encoding: 'utf8' }).trim();
            if (result) {
                const pids = result.split('\n');
                for (const pid of pids) {
                    try {
                        execSync(`kill -9 ${pid}`, { stdio: 'pipe' });
                        log('info', `Killed remaining process on port ${port} (${name})`);
                    } catch {
                        // Process may have already exited
                    }
                }
            }
        } catch {
            // No process on port or lsof not available
        }
    }
}

/**
 * Main entry point.
 */
function main() {
    console.log('');
    log('info', 'Stopping TronRelic services (Termux mode)...');
    console.log('');

    // Stop services in reverse order of startup
    const services = ['frontend', 'backend', 'redis', 'mongodb'];

    for (const service of services) {
        stopService(service);
    }

    // Cleanup any remaining processes
    cleanupPorts();

    console.log('');
    log('success', 'All services stopped');
    log('info', 'MongoDB data preserved in .mongodb/');
    log('info', 'Logs available in .run/');
}

main();
