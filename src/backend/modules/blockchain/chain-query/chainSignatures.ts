/**
 * @fileoverview Names for well-known contract method selectors and event signatures.
 *
 * The chain data stores a contract call's data and an event's topics as raw
 * hex. A model reading `a9059cbb` or `ddf252ad…` cannot tell it is a token
 * transfer, so the contract tools label the common ones. Each value here is the
 * keccak-256 hash of the signature beside it (the first 4 bytes for a method,
 * all 32 for an event), and the tests recompute every one, so a typo cannot
 * mislabel a call.
 *
 * A label only says the hash matches. Any contract can define a function with
 * the same signature, so a `transfer` call on an unknown contract is a call to
 * something named `transfer`, not proof of a token transfer.
 *
 * @module backend/modules/blockchain/chain-query/chainSignatures
 */

import { TRANSFER_EVENT_TOPIC, topicToAddress, wordToDecimal } from '../contract-events.js';

/** Known method selectors, the first 4 bytes of `keccak256(signature)` as 8 hex characters. */
export const KNOWN_METHOD_SELECTORS: Readonly<Record<string, string>> = {
    a9059cbb: 'transfer(address,uint256)',
    '095ea7b3': 'approve(address,uint256)',
    '23b872dd': 'transferFrom(address,address,uint256)',
    '39509351': 'increaseAllowance(address,uint256)',
    a457c2d7: 'decreaseAllowance(address,uint256)',
    d0e30db0: 'deposit()',
    '2e1a7d4d': 'withdraw(uint256)',
    ac9650d8: 'multicall(bytes[])',
    '38ed1739': 'swapExactTokensForTokens(uint256,uint256,address[],address,uint256)',
    '7ff36ab5': 'swapExactETHForTokens(uint256,address[],address,uint256)',
    '18cbafe5': 'swapExactTokensForETH(uint256,uint256,address[],address,uint256)',
    '8803dbee': 'swapTokensForExactTokens(uint256,uint256,address[],address,uint256)',
    fb3bdb41: 'swapETHForExactTokens(uint256,address[],address,uint256)',
    '4a25d94a': 'swapTokensForExactETH(uint256,uint256,address[],address,uint256)',
    e8e33700: 'addLiquidity(address,address,uint256,uint256,uint256,uint256,address,uint256)',
    baa2abde: 'removeLiquidity(address,address,uint256,uint256,uint256,address,uint256)',
    '40c10f19': 'mint(address,uint256)',
    '42966c68': 'burn(uint256)',
    '42842e0e': 'safeTransferFrom(address,address,uint256)',
    a22cb465: 'setApprovalForAll(address,bool)'
};

/** `topics[0]` of `Approval(address,address,uint256)`. */
export const APPROVAL_EVENT_TOPIC = '8c5be1e5ebec7d5bd14f71427d1e84f3dd0314c0f7b2291e5b200ac8c7c3b925';

/** Known event signatures, keyed by `topics[0]`: the full keccak-256 hash as 64 hex characters. */
export const KNOWN_EVENT_TOPICS: Readonly<Record<string, string>> = {
    [TRANSFER_EVENT_TOPIC]: 'Transfer(address,address,uint256)',
    [APPROVAL_EVENT_TOPIC]: 'Approval(address,address,uint256)',
    '17307eab39ab6107e8899845ad3d59bd9653f200f220920489ca2b5937696c31': 'ApprovalForAll(address,address,bool)',
    d78ad95fa46c994b6551d0da85fc275fe613ce37657fb8d5e3d130840159d822: 'Swap(address,uint256,uint256,uint256,uint256,address)',
    '1c411e9a96e071241c2f21f7726b17ae89e3cab4c78be50e062b03a9fffbbad1': 'Sync(uint112,uint112)',
    e1fffcc4923d04b559f4d29a8bfc6cda04eb5b0d3c460751c2402c5c5cc9109c: 'Deposit(address,uint256)',
    '7fcf532c15f0a6db0bd6d0e038bea71d30d808c7d98cb3bf7268a95bf5081b65': 'Withdrawal(address,uint256)',
    '4c209b5fc8ad50758f13e2e1088ba56a560dff690a1c6fef26394f4c03821c4f': 'Mint(address,uint256,uint256)',
    dccd412f0b1252819cb1fd330b93224ca42612892bb3f4f789976e6d81936496: 'Burn(address,uint256,uint256,address)',
    cb8241adb0c3fdb35b70c24ce35c5eb0c17af7431c99f827d44a445ca624176a: 'Issue(uint256)',
    '702d5967f45f6513a38ffc42d6ba9bf230bd40e8f53b16363c7eb4fd2deb9a44': 'Redeem(uint256)',
    '42e160154868087d6bfdc0ca23d96a1c1cfa32f1b72ba9ba27b69b98a0d819dc': 'AddedBlackList(address)',
    d7e9ec6e6ecd65492dce6bf513cd6867560d49544421d0783ddf06e76c24470c: 'RemovedBlackList(address)',
    '61e6e66b0d6339b2980aecc6ccc0039736791f0ccde9ed512e789a7fbdd698c6': 'DestroyedBlackFunds(address,uint256)'
};

/** One 32-byte ABI word as hex characters. */
const WORD_HEX = 64;

/** Matches a full event topic: 64 hex characters. */
const TOPIC_HEX = /^[0-9a-f]{64}$/;

/**
 * Event names a caller may filter by, mapped to their topic. Built from
 * {@link KNOWN_EVENT_TOPICS}; every name there is unique, so none is ambiguous.
 */
export const EVENT_TOPICS_BY_NAME: Readonly<Record<string, string>> = Object.fromEntries(
    Object.entries(KNOWN_EVENT_TOPICS).map(([topic, signature]) => [signature.slice(0, signature.indexOf('(')), topic])
);

/**
 * The method selector of a contract call: the first 4 bytes of its call data.
 *
 * @param data - The call data as stored, lowercase hex without `0x`.
 * @returns The selector as 8 hex characters, or an empty string when the call
 *          carried fewer than 4 bytes (a plain TRX send to a contract).
 */
export function methodSelector(data: string): string {
    return data.length >= 8 ? data.slice(0, 8).toLowerCase() : '';
}

/**
 * The signature behind a selector, when it is a well-known one.
 *
 * @param selector - 8 hex characters.
 * @returns The signature, or null when the selector is not in the catalog.
 */
export function methodSignature(selector: string): string | null {
    return KNOWN_METHOD_SELECTORS[selector] ?? null;
}

/**
 * The signature behind an event topic, when it is a well-known one.
 *
 * @param topic0 - The event's first topic, 64 hex characters.
 * @returns The signature, or null when the topic is not in the catalog.
 */
export function eventSignature(topic0: string): string | null {
    return KNOWN_EVENT_TOPICS[topic0] ?? null;
}

/**
 * Read an event filter a caller supplied: a known event name such as
 * `Transfer` in any case, or a raw topic of 64 hex characters, with or
 * without `0x`.
 *
 * @param value - The trimmed filter text.
 * @returns The topic, or null when the text is neither form.
 */
export function resolveEventTopic(value: string): string | null {
    const lower = value.toLowerCase().replace(/^0x/, '');
    const named = Object.entries(EVENT_TOPICS_BY_NAME).find(([name]) => name.toLowerCase() === value.toLowerCase());
    let topic: string | null = null;
    if (named) {
        topic = named[1];
    } else if (TOPIC_HEX.test(lower)) {
        topic = lower;
    }
    return topic;
}

/** A well-known event decoded into named fields. */
export interface IDecodedEvent {
    /** The event's name, such as `Transfer`. */
    name: string;
    /** Named fields. Addresses are base58; amounts are base-unit decimal strings. */
    fields: Record<string, string>;
}

/**
 * Decode the well-known events whose layout is fixed: TRC-20 and TRC-721
 * `Transfer`, `Approval`, and Tether's issue, redeem, and blacklist events.
 *
 * Anything else, including a known event whose topics or data do not have
 * the expected shape, is left undecoded rather than guessed at. That happens
 * when a contract reuses a well-known name with different indexed fields.
 *
 * @param topics - The event's topics, `topics[0]` first.
 * @param data - The event's non-indexed data, hex without `0x`.
 * @returns The decoded event, or null when it is not one this function knows.
 */
export function decodeKnownEvent(topics: readonly string[], data: string): IDecodedEvent | null {
    const [topic0, first, second, third] = topics;
    /**
     * Read one 32-byte word of the event's data, so a short data field is
     * reported as missing rather than sliced into a wrong value.
     *
     * @param index - Which word, counting from 0.
     * @returns The word as 64 hex characters, or null when the data is too short.
     */
    const word = (index: number): string | null => data.length >= (index + 1) * WORD_HEX ? data.slice(index * WORD_HEX, (index + 1) * WORD_HEX) : null;
    const name = topic0 ? eventSignature(topic0)?.split('(')[0] : undefined;
    let decoded: IDecodedEvent | null = null;

    if ((name === 'Transfer' || name === 'Approval') && first?.length === WORD_HEX && second?.length === WORD_HEX) {
        const from = topicToAddress(first);
        const to = topicToAddress(second);
        const keys = name === 'Transfer' ? ['from', 'to'] : ['owner', 'spender'];
        if (from && to && topics.length === 3 && word(0)) {
            decoded = { name, fields: { [keys[0]]: from, [keys[1]]: to, amount: wordToDecimal(word(0) as string) } };
        } else if (from && to && name === 'Transfer' && topics.length === 4 && third?.length === WORD_HEX) {
            decoded = { name, fields: { from, to, tokenId: wordToDecimal(third) } };
        }
    } else if ((name === 'Issue' || name === 'Redeem') && topics.length === 1 && word(0)) {
        decoded = { name, fields: { amount: wordToDecimal(word(0) as string) } };
    } else if ((name === 'AddedBlackList' || name === 'RemovedBlackList') && topics.length === 1 && word(0)) {
        const user = topicToAddress(word(0) as string);
        decoded = user ? { name, fields: { user } } : null;
    } else if (name === 'DestroyedBlackFunds' && topics.length === 1 && word(0) && word(1)) {
        const user = topicToAddress(word(0) as string);
        decoded = user ? { name, fields: { user, amount: wordToDecimal(word(1) as string) } } : null;
    }

    return decoded;
}
