/**
 * @fileoverview Reading a bounded whole number out of a text input.
 *
 * Several forms on the System page hold their numeric fields as strings, so a
 * half-typed or momentarily empty value survives editing instead of snapping
 * back to a coerced number on every keystroke. That choice moves the parsing to
 * save time, and every one of those forms needs the same three checks. Keeping
 * them here means the TronGrid card and the emit buffer card cannot disagree
 * about what an empty box means.
 *
 * @module app/(core)/system/system/components/field-integer
 */

/** The inclusive range a numeric field accepts, mirroring the backend's own bound. */
export interface IFieldBounds {
    /** Smallest accepted value. */
    min: number;
    /** Largest accepted value. */
    max: number;
}

/**
 * Read one numeric form field out of its text state.
 *
 * A blank box is an error rather than a number. `Number('')` is `0`, and zero is
 * a legal value for several of these settings, so coercing would turn "I cleared
 * this field while editing" into "I want this feature switched off" and report a
 * successful save. An operator who blanked a field meant to leave it alone.
 *
 * @param raw - Current text contents of the input, exactly as typed.
 * @param bounds - Range the field accepts. Passed in rather than looked up here
 *                 because each field has its own, and the caller is what knows
 *                 which field this is.
 * @returns The value, or null when the box is blank, holds something that is not
 *          a whole number, or falls outside the range — leaving the caller to
 *          name the offending field in its own message.
 */
export function readFieldInteger(raw: string, bounds: IFieldBounds): number | null {
    let result: number | null = null;

    if (raw.trim()) {
        const value = Number(raw);

        if (Number.isInteger(value) && value >= bounds.min && value <= bounds.max) {
            result = value;
        }
    }

    return result;
}
