/**
 * @fileoverview Row count for an AI prompt editor, sized to the prompt it holds.
 *
 * The two system prompt editors on the `/system/localization` Settings tab,
 * this module's for interface text and core's content translation panel beside
 * it, hold prompts of very different lengths. A fixed row count leaves a short
 * prompt above a block of empty editor that pushes the second panel down the
 * page, so both size their editor with this function and grow and shrink alike.
 *
 * @module modules/localization/components/admin/promptEditorRows
 */

/** Fewest rows an editor shows, so an empty prompt still reads as a place to write. */
const MIN_ROWS = 4;

/** Most rows an editor grows to before its text scrolls inside it, so a long glossary does not push the rest of the tab off the screen. */
const MAX_ROWS = 16;

/** Blank rows kept below the last line, so there is room to start the next one. */
const SPARE_ROWS = 2;

/**
 * Size a prompt editor to its text: one row per line plus two spare, between
 * four and sixteen. Called on every render with the text being edited, so the
 * editor grows as lines are added.
 *
 * Lines are counted by their line breaks. A long line that wraps in a narrow
 * editor still counts once, so on a phone the text may scroll inside the
 * editor before it reaches the cap.
 *
 * @param text - The prompt the editor holds now.
 * @returns The `rows` value for the editor's textarea.
 */
export function promptEditorRows(text: string): number {
    const lines = text.split('\n').length;
    return Math.min(MAX_ROWS, Math.max(MIN_ROWS, lines + SPARE_ROWS));
}
