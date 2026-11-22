/**
 * @fileoverview Prefix shared by every scheduler job the tools module registers.
 *
 * The Schedules tab on `/system/tools` filters jobs by this prefix rather than
 * by a fixed list of names, so a job the module adds later appears there with
 * no change to the page. The backend names its jobs with it and the frontend
 * filters on it, so it lives here once.
 */

/**
 * Prefix of the tools module's scheduler job names, such as
 * `tools:staking-rewards-refresh`.
 */
export const TOOLS_JOB_PREFIX = 'tools:';
