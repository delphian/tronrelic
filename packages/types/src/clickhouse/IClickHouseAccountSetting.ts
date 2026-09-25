/**
 * @fileoverview One setting as ClickHouse itself reports it for an account's
 * settings profile.
 *
 * The admin page shows these values read back from the server rather than the
 * values the platform last saved, so a profile someone changed by hand on the
 * server shows up as a difference instead of being hidden.
 */

/**
 * One row of `system.settings_profile_elements` for an account's profile.
 */
export interface IClickHouseAccountSetting {
    /** ClickHouse setting name, such as `max_execution_time`. */
    name: string;

    /** Value the profile sets, or null when the row only states a constraint. */
    value: string | null;

    /** Lowest value a caller may set, or null when there is no lower bound. */
    min: string | null;

    /** Highest value a caller may set, or null when there is no upper bound. */
    max: string | null;
}
