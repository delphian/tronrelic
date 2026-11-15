/**
 * @fileoverview Admin controller for the sign-up protections: the site-wide
 * cap on new accounts and the email domain rules.
 *
 * Backs the Sign-ups tab of `/system/users`. Mounted under
 * `/api/admin/users/sign-ups` behind `requireAdmin`. Handlers validate the
 * request shape through the config store's own checks, so the form and the
 * store cannot disagree about what is accepted, and answer every successful
 * change with a fresh report so the tab redraws from one response.
 */

import type { Request, Response } from 'express';
import type { ISystemLogService } from '@/types';
import { SIGNUP_PROTECTION_LIMITS } from '@/types';
import { SignupProtectionConfigStore, type IEmailDomainRuleInput } from '../services/SignupProtectionConfigStore.js';
import type { SignupProtectionReportService } from '../services/SignupProtectionReportService.js';

/**
 * Admin endpoints for reading the sign-up report and changing the protections.
 */
export class SignUpProtectionController {
    /**
     * @param config - Stores the settings.
     * @param report - Builds the report each response carries.
     * @param logger - The identity module's logger.
     */
    constructor(
        private readonly config: SignupProtectionConfigStore,
        private readonly report: SignupProtectionReportService,
        private readonly logger: ISystemLogService
    ) {}

    /**
     * GET / — the settings and the sign-up report.
     *
     * @param _req - Express request; nothing is read from it.
     * @param res - Express response; answers `ISignupProtectionReport`.
     * @returns Resolves once the response has been written.
     */
    async getReport(_req: Request, res: Response): Promise<void> {
        await this.respondWithReport(res, 200);
    }

    /**
     * PUT /cap — replace the cap settings. Body `{ mode, maxPerHour }`.
     *
     * @param req - Express request; reads the body and the acting admin.
     * @param res - Express response; answers the report, or 400 naming the field to fix.
     * @returns Resolves once the response has been written.
     */
    async setCap(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as { mode?: unknown; maxPerHour?: unknown };
        const checked = SignupProtectionConfigStore.validateCap(body);
        if (!checked.ok) {
            res.status(400).json({ error: 'InvalidCap', message: checked.message });
        } else {
            await this.change(res, () => this.config.setCap(checked.value, req.userId ?? null), 'Failed to save the sign-up cap');
        }
    }

    /**
     * PUT /domains/:domain — add or replace the rule for a domain. Body
     * `{ action, maxCodesPerHour?, note? }`; the domain comes from the path.
     *
     * @param req - Express request; reads the path, the body, and the acting admin.
     * @param res - Express response; answers the report, 400 naming the field to
     *   fix, or 409 when the store already holds the most rules allowed.
     * @returns Resolves once the response has been written.
     */
    async putDomainRule(req: Request, res: Response): Promise<void> {
        const body = (req.body ?? {}) as Omit<IEmailDomainRuleInput, 'domain'>;
        const checked = SignupProtectionConfigStore.validateDomainRule({ ...body, domain: req.params.domain }, req.userId ?? null);
        if (!checked.ok) {
            res.status(400).json({ error: 'InvalidDomainRule', message: checked.message });
        } else {
            await this.change(res, () => this.config.upsertDomainRule(checked.value), 'Failed to save the email domain rule', {
                status: 409,
                error: 'TooManyRules',
                message: `At most ${SIGNUP_PROTECTION_LIMITS.maxDomainRules} email domain rules can be stored. Remove one first.`
            });
        }
    }

    /**
     * DELETE /domains/:domain — remove the rule for a domain.
     *
     * @param req - Express request; reads the path and the acting admin.
     * @param res - Express response; answers the report, or 404 when no rule exists for the domain.
     * @returns Resolves once the response has been written.
     */
    async deleteDomainRule(req: Request, res: Response): Promise<void> {
        await this.change(res, () => this.config.removeDomainRule(req.params.domain, req.userId ?? null), 'Failed to remove the email domain rule', {
            status: 404,
            error: 'NotFound',
            message: `No email domain rule exists for "${req.params.domain}".`
        });
    }

    /**
     * Run one change and answer with the fresh report, or with the given
     * refusal when the change returns null.
     *
     * @param res - Express response.
     * @param apply - The change; resolves to null when it was refused.
     * @param failureMessage - Logged and returned when the change throws.
     * @param refusal - Status and body to answer with when `apply` returns null.
     * @returns Resolves once the response has been written.
     */
    private async change(
        res: Response,
        apply: () => Promise<unknown>,
        failureMessage: string,
        refusal?: { status: number; error: string; message: string }
    ): Promise<void> {
        try {
            const outcome = await apply();
            if (outcome === null && refusal) {
                res.status(refusal.status).json({ error: refusal.error, message: refusal.message });
            } else {
                await this.respondWithReport(res, 200);
            }
        } catch (error: unknown) {
            this.logger.error({ err: error }, failureMessage);
            res.status(500).json({ error: 'InternalError', message: failureMessage });
        }
    }

    /**
     * Build the report and write it.
     *
     * @param res - Express response.
     * @param status - HTTP status for a successful build.
     * @returns Resolves once the response has been written.
     */
    private async respondWithReport(res: Response, status: number): Promise<void> {
        try {
            res.status(status).json(await this.report.build());
        } catch (error: unknown) {
            this.logger.error({ err: error }, 'Failed to build the sign-up report');
            res.status(500).json({ error: 'InternalError', message: 'Failed to build the sign-up report' });
        }
    }
}
