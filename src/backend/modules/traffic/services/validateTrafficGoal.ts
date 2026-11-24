/**
 * @fileoverview The naming and property rules for a goal event, checked before
 * anything is recorded.
 *
 * Why it exists: `ITrafficGoal` promises callers that a malformed goal is
 * refused with an error, so a mistake shows up in the caller's tests instead
 * of as a figure that silently never appears. The goal name and property keys
 * also become ClickHouse dictionary values and admin-facing labels, so they
 * are held to a small, predictable alphabet. The same name and key patterns
 * are exported so the AI tools validate a requested goal with exactly the rule
 * ingestion applies.
 *
 * Rules (from `ITrafficGoal`):
 * - `name` is `<owner>:<action>`, lower-case letters, digits, and hyphens on
 *   each side, at most 64 characters.
 * - `properties` holds at most 8 entries; keys are lower-case letters, digits,
 *   and underscores, start with a letter, and are at most 32 characters;
 *   values are strings of at most 128 characters.
 */

import type { ITrafficGoal } from '@/types';

/** Longest goal name accepted, owner and action together. */
export const MAX_GOAL_NAME_LENGTH = 64;

/** Most properties one goal event may carry. */
export const MAX_GOAL_PROPERTIES = 8;

/** Longest property value accepted. */
export const MAX_GOAL_PROPERTY_VALUE_LENGTH = 128;

/** `<owner>:<action>`, each side lower-case letters, digits, and hyphens. */
export const GOAL_NAME_PATTERN = /^[a-z0-9-]+:[a-z0-9-]+$/;

/** A property key: a lower-case letter, then up to 31 lower-case letters, digits, or underscores. */
export const GOAL_PROPERTY_KEY_PATTERN = /^[a-z][a-z0-9_]{0,31}$/;

/**
 * Raised when a goal breaks the contract's rules. A distinct class so the
 * recorder's callers, and tests, can tell a rejected goal apart from a
 * storage failure.
 */
export class TrafficGoalValidationError extends Error {
    /**
     * @param message - Which rule the goal broke, written for the developer
     *   who called `recordGoal`.
     */
    constructor(message: string) {
        super(message);
        this.name = 'TrafficGoalValidationError';
    }
}

/**
 * Check whether a goal name follows the `<owner>:<action>` rule. Shared with
 * the AI tools so a model asking for a goal is held to the same rule a
 * component recording one is.
 *
 * @param name - The candidate goal name.
 * @returns True when the name is well formed and short enough.
 */
export function isValidGoalName(name: unknown): name is string {
    return typeof name === 'string' && name.length <= MAX_GOAL_NAME_LENGTH && GOAL_NAME_PATTERN.test(name);
}

/**
 * Check whether a property key follows the key rule. Shared with the AI tools
 * and the breakdown route for the same reason as {@link isValidGoalName}.
 *
 * @param key - The candidate property key.
 * @returns True when the key is well formed.
 */
export function isValidGoalPropertyKey(key: unknown): key is string {
    return typeof key === 'string' && GOAL_PROPERTY_KEY_PATTERN.test(key);
}

/**
 * Validate a goal against the contract and return a clean copy of it.
 *
 * The copy matters as much as the check: the caller's object could be changed
 * after the call returns, and a property object with a prototype other than
 * `Object` could carry inherited keys. Only own string entries are copied.
 *
 * @param goal - The goal a component passed to `recordGoal`.
 * @returns The goal's name and a plain copy of its properties (empty when none
 *   were given).
 * @throws TrafficGoalValidationError when any rule is broken.
 */
export function validateTrafficGoal(goal: ITrafficGoal): { name: string; properties: Record<string, string> } {
    if (!goal || typeof goal !== 'object') {
        throw new TrafficGoalValidationError('A goal must be an object with a "name".');
    }
    if (!isValidGoalName(goal.name)) {
        throw new TrafficGoalValidationError(
            `Goal name must be "<owner>:<action>" using lower-case letters, digits, and hyphens, at most ` +
            `${MAX_GOAL_NAME_LENGTH} characters, such as "resource-markets:outbound-click". Got: ${String(goal.name)}`
        );
    }

    const properties: Record<string, string> = {};
    const raw: unknown = goal.properties;
    if (raw !== undefined) {
        const isPlainObject = raw !== null && typeof raw === 'object' && !Array.isArray(raw) &&
            (Object.getPrototypeOf(raw) === Object.prototype || Object.getPrototypeOf(raw) === null);
        if (!isPlainObject) {
            throw new TrafficGoalValidationError('Goal properties must be a plain object of string values.');
        }
        const entries = Object.entries(raw as Record<string, unknown>);
        if (entries.length > MAX_GOAL_PROPERTIES) {
            throw new TrafficGoalValidationError(
                `A goal may carry at most ${MAX_GOAL_PROPERTIES} properties. Got: ${entries.length}`
            );
        }
        for (const [key, value] of entries) {
            if (!isValidGoalPropertyKey(key)) {
                throw new TrafficGoalValidationError(
                    `Goal property key "${key}" must start with a lower-case letter and use only lower-case ` +
                    'letters, digits, and underscores, at most 32 characters.'
                );
            }
            if (typeof value !== 'string' || value.length > MAX_GOAL_PROPERTY_VALUE_LENGTH) {
                throw new TrafficGoalValidationError(
                    `Goal property "${key}" must be a string of at most ${MAX_GOAL_PROPERTY_VALUE_LENGTH} characters.`
                );
            }
            properties[key] = value;
        }
    }

    return { name: goal.name, properties };
}
