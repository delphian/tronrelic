/**
 * @fileoverview The status one decided curation item closed with.
 */

import type { CURATION_DECISIONS } from './CURATION_DECISIONS.js';

/** One of {@link CURATION_DECISIONS}: every curation status except `pending`. */
export type CurationDecision = typeof CURATION_DECISIONS[number];
