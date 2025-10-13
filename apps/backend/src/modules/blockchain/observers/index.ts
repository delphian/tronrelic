/**
 * Blockchain transaction observers.
 *
 * Exports observer infrastructure and auto-loads all observer implementations.
 * Simply importing this module will automatically discover and register all observers.
 */
export { BaseObserver } from './BaseObserver.js';
export { ObserverRegistry } from './ObserverRegistry.js';

// Auto-load observers by importing them
// Observers self-register on module load via side effects
