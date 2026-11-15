/**
 * @fileoverview The one operation the auth facade and the connected-apps
 * service need to report that an account was just used.
 */

/**
 * Records that an account made a signed-in request or an MCP call, so the
 * Users tab can show and sort by when each account was last seen.
 */
export interface IAccountActivityRecorder {
    /**
     * Note that an account was just seen. Never throws and never waits on the
     * database, because it runs on every signed-in request.
     *
     * @param userId - Better Auth user id of the account.
     */
    recordSeen(userId: string): void;
}
