/**
 * @fileoverview Find-and-replace edits for the module's propose tools.
 *
 * `ai-propose-saved-prompt-edit` and `ai-propose-prompt-variable-edit` both
 * let a model change a long stored text by sending small `{ find, replace }`
 * steps rather than the whole text. Both read and apply those steps here, so
 * the rules a model learns from one tool hold for the other:
 *
 * - Steps apply in order, each to the text the steps before it produced.
 * - Each `find` must occur exactly once, so an edit never lands somewhere the
 *   model did not intend.
 * - Every refusal is an `AiToolInputError` the model can correct from.
 *
 * @module backend/modules/ai-tools/applyTextEdits
 */

import { AiToolInputError } from './runAiToolCall.js';

/** Most find-and-replace edits one call may carry. */
export const MAX_TEXT_EDITS = 50;

/** Longest `find` or `replace` string accepted. */
export const MAX_TEXT_EDIT_CHARS = 20_000;

/** One find-and-replace step, after validation. */
export interface ITextEdit {
    /** Exact text that must occur once in the current text. */
    find: string;
    /** What replaces it; empty deletes the found text. */
    replace: string;
}

/**
 * How error messages name the text being edited, so a refusal tells the model
 * which text to re-read and with which tool.
 */
export interface ITextEditTarget {
    /** The edited text, as a phrase such as `the prompt body`. */
    noun: string;
    /** The tool that returns the text exactly, such as `ai-get-saved-prompts`. */
    readTool: string;
}

/**
 * Count how many times `needle` occurs in `text`, without overlap, stopping at
 * two because the caller only needs to know whether it is exactly one.
 */
function countOccurrences(text: string, needle: string): number {
    let count = 0;
    let from = text.indexOf(needle);
    while (from !== -1 && count < 2) {
        count += 1;
        from = text.indexOf(needle, from + needle.length);
    }
    return count;
}

/**
 * Read the raw `edits` argument a model sent, refusing anything it can
 * correct: a missing or oversized list, or a step whose fields are not strings
 * within the length limit.
 *
 * @param value - The raw `edits` argument.
 * @returns The validated edits, in order.
 */
export function readTextEdits(value: unknown): ITextEdit[] {
    if (!Array.isArray(value) || value.length === 0 || value.length > MAX_TEXT_EDITS) {
        throw new AiToolInputError(`edits must be a list of 1 to ${MAX_TEXT_EDITS} { find, replace } objects.`);
    }
    return value.map((entry, index) => {
        const find = (entry as { find?: unknown } | null)?.find;
        const replace = (entry as { replace?: unknown } | null)?.replace;
        if (typeof find !== 'string' || find.length === 0 || find.length > MAX_TEXT_EDIT_CHARS) {
            throw new AiToolInputError(`edits[${index}].find must be a non-empty string of at most ${MAX_TEXT_EDIT_CHARS} characters.`);
        }
        if (typeof replace !== 'string' || replace.length > MAX_TEXT_EDIT_CHARS) {
            throw new AiToolInputError(`edits[${index}].replace must be a string of at most ${MAX_TEXT_EDIT_CHARS} characters (it may be empty).`);
        }
        return { find, replace };
    });
}

/**
 * Apply validated edits in order. Each `find` must occur exactly once in the
 * text as it stands after the edits before it.
 *
 * @param text - The current stored text.
 * @param edits - The validated edits.
 * @param target - How refusals name the text and the tool that reads it.
 * @returns The text after every edit.
 */
export function applyTextEdits(text: string, edits: ITextEdit[], target: ITextEditTarget): string {
    return edits.reduce((current, edit, index) => {
        const occurrences = countOccurrences(current, edit.find);
        if (occurrences !== 1) {
            throw new AiToolInputError(occurrences === 0
                ? `edits[${index}].find does not occur in ${target.noun} (after the edits before it). Copy the text exactly, including spaces and line breaks; read it with ${target.readTool}.`
                : `edits[${index}].find occurs more than once in ${target.noun}. Include more surrounding text so it matches exactly one place.`);
        }
        return current.replace(edit.find, () => edit.replace);
    }, text);
}
