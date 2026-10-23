/**
 * @file MAX_TRANSLATION_STATUS_IDS.ts
 *
 * The most items one `summarizeTranslations` call summarizes. Telling whether
 * a translation is stale means reading each item's English text, so the batch
 * is capped to keep one admin list request bounded. It sits well above the
 * page size of any admin list, so a list never reaches it in normal use.
 */

/** Largest batch of content ids one translation status summary covers. */
export const MAX_TRANSLATION_STATUS_IDS = 200;
