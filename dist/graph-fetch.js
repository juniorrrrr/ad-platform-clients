// Single HTTP layer for every Graph API call (Facebook Ads discovery,
// Facebook Page Insights, Instagram) — replaces the two near-identical
// `igFetch`/`fbFetch` implementations that used to live separately in
// instagram-api.ts and facebook-api.ts (fragile point #12 in the
// architecture review: any error-handling improvement had to be made and
// kept in sync in both places). Every caller gets the same GraphApiError
// shape (code + subcode + httpStatus), which is what classifyGraphError()
// needs to work at all.
import { GraphApiError, parseRateLimitHeaders, withRateLimitBackoff, } from "./graph-error";
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
export async function graphFetchWithMeta(url, init) {
    return withRateLimitBackoff(async () => {
        const res = await fetch(url, init);
        const json = (await res.json());
        const rateLimit = parseRateLimitHeaders(res.headers);
        if (json.error) {
            throw new GraphApiError(json.error.message, json.error.code ?? 0, json.error.error_subcode, res.status);
        }
        if (!res.ok) {
            throw new GraphApiError(`HTTP ${res.status}`, 0, undefined, res.status);
        }
        return { data: json, rateLimit };
    });
}
export async function graphFetch(url, init) {
    return (await graphFetchWithMeta(url, init)).data;
}
//# sourceMappingURL=graph-fetch.js.map