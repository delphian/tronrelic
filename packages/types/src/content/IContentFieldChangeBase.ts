/**
 * @file IContentFieldChangeBase.ts
 *
 * The part every kind of field change shares: which field changed and the
 * label a reviewer reads for it.
 */

/**
 * Identity of a changed field.
 */
export interface IContentFieldChangeBase {
    /** The field's name on the content type's record, such as `bodyMarkdown`. */
    field: string;

    /** The field's human-readable label, such as `Body`. */
    label: string;
}
