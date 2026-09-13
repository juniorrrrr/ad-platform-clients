/**
 * Shared logic for fetching ALL Meta Ads accounts a user has access to.
 * Used by both the OAuth callback and the refreshMetaAdAccounts server function.
 *
 * Meta account_status codes:
 *   1   = ACTIVE
 *   2   = DISABLED  (by Meta policy)
 *   3   = UNSETTLED
 *   7   = PENDING_RISK_REVIEW
 *   8   = PENDING_SETTLEMENT
 *   9   = IN_GRACE_PERIOD
 *   100 = PENDING_CLOSURE
 *   101 = CLOSED
 *
 * We include everything except 101 (CLOSED) — agency accounts in states
 * 3/7/8/9/100 are still accessible and must appear in the selector.
 */
export type NormalizedAdAccount = {
    accountId: string;
    name: string;
    currency: string;
    accountStatus: number;
    timezoneName: string;
    businessId: string | null;
    businessName: string | null;
};
export declare function fetchAllMetaAdAccounts(token: string): Promise<NormalizedAdAccount[]>;
//# sourceMappingURL=meta-accounts.d.ts.map