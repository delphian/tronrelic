/**
 * @fileoverview Accepted shape of a Google Ads conversion label.
 *
 * The label is joined to the tag id as `AW-…/<label>` in the conversion
 * event, so the backend accepts only the letters, digits, hyphens, and
 * underscores Google issues.
 */

/** A Google Ads conversion label, such as `AbC-D_efG12hIjKlMn`. */
export const GOOGLE_ADS_CONVERSION_LABEL_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
