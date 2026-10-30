/**
 * @fileoverview What each chain query tool tells a model after a ClickHouse limit stopped one of its reads.
 *
 * A limit error is only useful to a model if it says what to change, and the
 * right change depends on what the tool's reads grow with. A wallet tool reads
 * one address's rows, so a busy address is the usual cause and a token filter
 * narrows the read. A contract or chain-wide tool reads every row in the window
 * and keeps a few, so the target's own activity barely matters and only a
 * shorter window helps. One piece of advice for every tool sent models after
 * the wrong lever: the methods view of `blockchain-contract-activity` failed
 * for a contract with three calls, and the advice told the model to pick a
 * less active one.
 *
 * Each entry names only parameters the tool accepts, and describes the read
 * the tool's queries actually make, as `system-chain-query-tools.md` records
 * under Cost Guidance. Change an entry when the tool's queries change.
 *
 * @module backend/modules/blockchain/chain-query/tools/chainQueryLimitAdvice
 */

import { AI_TOOL_NAMES } from './chainQueryToolShared.js';

/** Advice for a tool whose read grows with one wallet's activity, with the token filter its ledger read is narrowed by. */
const WALLET_ADVICE =
    'This tool reads the one address\'s own transfers, so its cost follows how active that address is in the window. Shorten the window with hours or since/until, or add a token filter, which narrows the read. A very busy address such as an exchange hot wallet needs a window of an hour or two.';

/**
 * Advice per tool, keyed by tool name. A tool missing here gets the session's
 * default, which tells the model to shorten the window.
 */
export const chainQueryLimitAdvice: Readonly<Record<string, string>> = {
    [AI_TOOL_NAMES.addressProfile]:
        'This tool reads every value movement of the one address in the window, so its cost follows how active that address is. Shorten the window with hours or since/until. A very busy address such as an exchange hot wallet needs a window of an hour or two.',
    [AI_TOOL_NAMES.addressCounterparties]: WALLET_ADVICE,
    [AI_TOOL_NAMES.addressTransfers]: WALLET_ADVICE,
    [AI_TOOL_NAMES.traceFlow]:
        'Each hop reads the transfers of every address at that depth, so one busy address in the path, such as an exchange, is the usual cause. Shorten the window, or lower hops or branches.',
    [AI_TOOL_NAMES.tokenActivity]:
        'This tool reads every transfer in the window, whatever the token, because the ledger is sorted by address rather than token. The token filter does not narrow the read, so only a shorter window helps: try a few hours.',
    [AI_TOOL_NAMES.contractActivity]:
        'This tool reads every contract call in the window and keeps this contract\'s, so its cost follows the whole chain\'s activity more than this contract\'s. Only a shorter window helps, and a busy contract such as USDT needs a window of a few hours.',
    [AI_TOOL_NAMES.contractEvents]:
        'This tool reads this contract\'s own event logs, so its cost follows how many events the contract emitted. Shorten the window, or name one event with the event parameter.',
    [AI_TOOL_NAMES.contractPayouts]:
        'This tool reads the value this contract sent or received, so its cost follows how active the contract is. Shorten the window or add a token filter. The first-seen view adds one read per recipient, so it needs a short window for a contract paying many addresses.',
    [AI_TOOL_NAMES.contractCallGraph]:
        'This tool reads every internal transaction in the window and keeps this contract\'s calls, so its cost follows the whole chain\'s activity. Only a shorter window helps.',
    [AI_TOOL_NAMES.contractDeployments]:
        'This tool reads every transaction and internal transaction in the window to find the deployments, so its cost follows the whole chain\'s activity. Only a shorter window helps; the deployer filter does not narrow the read.',
    [AI_TOOL_NAMES.networkStats]:
        'This tool reads whole chain tables for the window, so only a shorter window helps.',
    [AI_TOOL_NAMES.findToken]:
        'Shorten the window with hours or since/until.',
    [AI_TOOL_NAMES.permissionChanges]:
        'Transactions signed under a permission number over a million a day, so the view listing them is the expensive one. Shorten the window, or pass an address.',
    [AI_TOOL_NAMES.resourceDelegations]:
        'A read with an address is cheap, but one without an address reads every delegation in the window, about four million a day. Pass an address, or shorten the window. Leave recoverSigners off unless the signers are needed.',
    [AI_TOOL_NAMES.newAccounts]:
        'Without a funder or account, this tool reads every transaction in the window, about ten million a day. Pass a funder or account, or shorten the window.',
    [AI_TOOL_NAMES.transactionTrace]:
        'Finding one transaction\'s event logs reads that whole day of logs, which makes includeEvents the expensive part. Retry without includeEvents.',
    [AI_TOOL_NAMES.getBlock]:
        'Reading one block normally stays well inside the limits. Retry with a smaller limit; if it fails again, the cause is on the server, not your input.'
};
