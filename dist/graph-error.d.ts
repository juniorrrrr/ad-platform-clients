export type GraphErrorClass = "TOKEN_INVALID" | "RATE_LIMITED" | "PERMISSION_MISSING_SCOPE" | "PERMISSION_ADVANCED_ACCESS" | "RESOURCE_STALE" | "TRANSIENT" | "UNKNOWN";
export declare class GraphApiError extends Error {
    readonly code: number;
    readonly subcode?: number | undefined;
    readonly httpStatus?: number | undefined;
    constructor(message: string, code: number, subcode?: number | undefined, httpStatus?: number | undefined);
}
/**
 * `X-App-Usage` / `X-Business-Use-Case-Usage` response headers — Meta reports
 * how close the app is to being throttled *before* it actually returns a 429/
 * rate-limit error code. Nothing in this codebase reads these today (see
 * fragile point #6 in the architecture review); graph-fetch.ts captures them
 * so callers can back off proactively instead of only reacting to a hard
 * failure.
 */
export interface RateLimitUsage {
    callCount?: number;
    totalCputime?: number;
    totalTime?: number;
}
export declare function parseRateLimitHeaders(headers: Headers): RateLimitUsage | null;
/** True once any usage bucket crosses this percentage — matches the ~79% the app already hit once (see Bug-Consumo-Excessivo-Meta-API-79-Porcento). */
export declare function isApproachingRateLimit(usage: RateLimitUsage | null, thresholdPct?: number): boolean;
export declare function classifyGraphError(err: unknown, grantedScopes?: readonly string[] | null): GraphErrorClass;
export declare function isTokenInvalid(err: unknown): boolean;
export declare function isRateLimited(err: unknown): boolean;
export declare function isPermissionError(err: unknown): boolean;
/**
 * Retries `fn` with exponential backoff + jitter, but ONLY for errors
 * classified as RATE_LIMITED — anything else rethrows immediately on the
 * first attempt. A rate-limited call must never fail the whole sync outright
 * (fragile point #6 in the architecture review: no code anywhere reacted to
 * 429/4/17/32/613 before this), but a genuine permission or token error
 * retried the same way would just waste attempts hitting the same wall.
 * Lives here (not graph-recovery.ts) so graph-fetch.ts — the actual HTTP
 * layer every Graph API call goes through — can use it directly without a
 * circular import (graph-recovery.ts depends on instagram-api.ts, which
 * depends on graph-fetch.ts).
 */
export declare function withRateLimitBackoff<T>(fn: () => Promise<T>, opts?: {
    maxAttempts?: number;
    baseDelayMs?: number;
}): Promise<T>;
//# sourceMappingURL=graph-error.d.ts.map