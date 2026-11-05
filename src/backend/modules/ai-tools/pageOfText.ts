/**
 * @fileoverview One page of a long text value, for AI tools that return text
 * too long to hand a model in one result.
 *
 * A prompt variable's value or a saved prompt's body can run past what one
 * tool result should put into a model's context, so those tools return the
 * text one page at a time and tell the caller where the next page starts.
 * Both tools cut their pages the same way, and keeping the cut here means a
 * fix to it reaches every tool that pages.
 *
 * @module backend/modules/ai-tools/pageOfText
 */

/** One page of a text value and where the following page begins. */
export interface ITextPage {
    /** The text from the requested offset to the end of the page. */
    content: string;
    /** The offset the next page starts at, or null when this page reaches the end of the value. */
    nextOffset: number | null;
}

/**
 * Cut one page out of a text value, starting at `offset`.
 *
 * The page never ends between the two halves of a UTF-16 surrogate pair, such
 * as an emoji. Splitting one would leave an unpaired half at the end of this
 * page and at the start of the next, and both would reach the model as
 * replacement characters. An offset past the end of the value yields an empty
 * last page rather than an error, so a caller that overshoots still gets a
 * well-formed answer.
 *
 * @param value - The full text being paged.
 * @param offset - Where the page starts, in characters, the same unit the caller reports as the value's total length.
 * @param pageChars - Most characters one page may hold, chosen by the calling tool for its context budget.
 * @returns The page text, and the offset of the next page or null when this page reaches the end.
 */
export function pageOfText(value: string, offset: number, pageChars: number): ITextPage {
    const start = Math.min(offset, value.length);
    let end = Math.min(start + pageChars, value.length);
    if (end < value.length && end > start) {
        const last = value.charCodeAt(end - 1);
        if (last >= 0xd800 && last <= 0xdbff) {
            end -= 1;
        }
    }
    return { content: value.slice(start, end), nextOffset: end < value.length ? end : null };
}
