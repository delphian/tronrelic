/**
 * @fileoverview Same-origin client for the sign-up protection admin endpoints
 * behind the Sign-ups tab of `/system/users`.
 *
 * Every call answers with the full `ISignupProtectionReport`, so the tab
 * redraws from the response of whatever change it just made. The admin's
 * session cookie authenticates each call.
 */

import type { EmailDomainRuleAction, ISignupCapConfig, ISignupProtectionReport } from '@/types';
import { parseJsonResponse } from './http';

/** Base path of the sign-up protection endpoints. */
const BASE_URL = '/api/admin/users/sign-ups';

/**
 * A domain rule as the admin form submits it. The domain travels in the path.
 */
export interface IDomainRuleSubmission {
    /** `block` or `slow`. */
    action: EmailDomainRuleAction;

    /** Shared hourly code budget for a `slow` rule; ignored for `block`. */
    maxCodesPerHour: number | null;

    /** The admin's reason for the rule. */
    note: string;
}

/**
 * Send a JSON body and parse the report the endpoint answers with.
 *
 * @param url - Endpoint to call.
 * @param method - HTTP method.
 * @param body - JSON body, or undefined for none.
 * @returns The fresh report.
 */
async function send(url: string, method: 'GET' | 'PUT' | 'DELETE', body?: unknown): Promise<ISignupProtectionReport> {
    const response = await fetch(url, {
        method,
        headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body)
    });
    return parseJsonResponse<ISignupProtectionReport>(response);
}

/**
 * Load the settings and the sign-up report.
 *
 * @returns The report.
 */
export function fetchSignupReport(): Promise<ISignupProtectionReport> {
    return send(BASE_URL, 'GET');
}

/**
 * Replace the site-wide cap settings.
 *
 * @param cap - The mode and the hourly maximum.
 * @returns The report after the change.
 */
export function saveSignupCap(cap: ISignupCapConfig): Promise<ISignupProtectionReport> {
    return send(`${BASE_URL}/cap`, 'PUT', cap);
}

/**
 * Add or replace the rule for an email domain.
 *
 * @param domain - The domain, as the admin typed it; the backend normalizes it.
 * @param rule - The action, budget, and note.
 * @returns The report after the change.
 */
export function saveDomainRule(domain: string, rule: IDomainRuleSubmission): Promise<ISignupProtectionReport> {
    return send(`${BASE_URL}/domains/${encodeURIComponent(domain)}`, 'PUT', rule);
}

/**
 * Remove the rule for an email domain.
 *
 * @param domain - The domain whose rule to remove.
 * @returns The report after the change.
 */
export function removeDomainRule(domain: string): Promise<ISignupProtectionReport> {
    return send(`${BASE_URL}/domains/${encodeURIComponent(domain)}`, 'DELETE');
}
