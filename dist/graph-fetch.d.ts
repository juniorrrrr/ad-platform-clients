import { type RateLimitUsage } from "./graph-error";
export interface GraphFetchResult<T> {
    data: T;
    rateLimit: RateLimitUsage | null;
}
/**
 * Fetches a Graph API URL and throws GraphApiError on any API-level or
 * HTTP-level failure. Callers that only need the payload can use
 * `graphFetch`; `graphFetchWithMeta` additionally returns the parsed rate
 * limit usage headers for callers that want to back off proactively.
 *
 * Wrapped in withRateLimitBackoff — every single Graph API call in this
 * codebase goes through this function, so this is the one place that
 * actually gives fragile point #6 (no rate-limit handling anywhere) a real
 * fix, instead of leaving it as a utility nothing calls.
 */
export declare function graphFetchWithMeta<T>(url: string, init?: RequestInit): Promise<GraphFetchResult<T>>;
export declare function graphFetch<T>(url: string, init?: RequestInit): Promise<T>;
//# sourceMappingURL=graph-fetch.d.ts.map