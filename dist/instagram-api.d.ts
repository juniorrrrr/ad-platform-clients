import { GraphApiError } from "./graph-error";
export interface IgPage {
    id: string;
    name: string;
    instagram_business_account?: {
        id: string;
    };
    /** Page access token — required for Facebook Page Insights/Posts calls (unlike the Instagram Graph API, which accepts the user token directly). Only present when the caller has admin access to the Page. */
    access_token?: string;
    /**
     * What the connecting identity can actually do on this Page — e.g.
     * ["ADVERTISE","ANALYZE"] for Business-Manager ad-only access vs.
     * ["MANAGE","CREATE_CONTENT","MODERATE"] for real Page admins. Used to
     * predict (without an extra API call) whether GET /{page-id}/posts will
     * be rejected with "(#10) ... pages_read_engagement permission or Page
     * Public Content Access feature" — see hasPageContentAccess in
     * facebook.functions.ts.
     */
    tasks?: string[];
}
export interface IgAccountInfo {
    id: string;
    name: string;
    username: string;
    profile_picture_url?: string;
    followers_count: number;
    media_count: number;
    biography?: string;
    website?: string;
}
export interface IgInsightValue {
    value: number;
    end_time: string;
}
export interface IgInsightSeries {
    name: string;
    period: string;
    values: IgInsightValue[];
}
export interface IgMedia {
    id: string;
    media_type: string;
    timestamp: string;
    caption?: string;
    thumbnail_url?: string;
    media_url?: string;
    permalink?: string;
}
export interface IgMediaInsights {
    impressions?: number;
    reach?: number;
    likes?: number;
    comments?: number;
    shares?: number;
    saved?: number;
    video_views?: number;
    total_interactions?: number;
}
export interface IgAudienceEntry {
    name: string;
    values: Array<{
        value: Record<string, number>;
        end_time?: string;
    }>;
}
export { GraphApiError as IgApiError };
/**
 * Graph API's own batch endpoint — up to 50 GET calls collapsed into a single
 * HTTP request/response. Each `graphBatch()` call is exactly ONE outbound
 * fetch, no matter how many `relativeUrls` it carries (chunked at 50, Graph's
 * own per-batch cap).
 *
 * This exists specifically to avoid one-HTTP-call-per-Business-Manager-edge:
 * a token that belongs to dozens of Business Managers (completely normal for
 * an agency admin or a long-time Facebook user) was issuing 2 individual
 * subrequests per business (owned_pages + client_pages). Cloudflare Workers
 * caps subrequests per invocation, and once that cap is hit every call after
 * it fails with "Too many subrequests by single Worker invocation" — silently,
 * for whichever businesses happened to be iterated last. That is what made
 * discovery succeed for some accounts and fail completely for others with the
 * exact same permissions: it depended on how many Business Managers the
 * token's identity belongs to, not on what they're allowed to see.
 */
export declare function graphBatch<T>(accessToken: string, relativeUrls: string[]): Promise<Array<T | null>>;
export interface LinkedPagesResult {
    pages: IgPage[];
    /**
     * Non-fatal diagnostics from the Business Manager discovery step (never
     * thrown — a BM/edge failure must not hide Pages the user DOES have direct
     * access to). Empty when every call succeeded. Each entry is the raw Graph
     * API error message, so a missing scope or an unapproved permission shows
     * up as an actual reason instead of a silent "0 accounts found".
     */
    warnings: string[];
}
/**
 * Lists every Facebook Page (and its linked Instagram Business account, if any)
 * the token's user can act on — combining /me/accounts (pages granted directly
 * to the personal profile) with every Business Manager's owned_pages/client_pages.
 *
 * /me/accounts alone only surfaces pages added directly to the user's profile.
 * Pages whose only access grant is a Business Manager partner/client assignment
 * (the normal way agencies share client Pages) are invisible there for anyone
 * except the page's original admin — which made Instagram account discovery
 * appear to work "only for my account". Merging in Business Manager pages fixes
 * that for any authenticated user with real permission on the account.
 *
 * IMPORTANT — two real bugs were found and fixed here, not one:
 *
 * 1) Earlier versions swallowed every Business Manager error into an empty
 *    array so one failing business wouldn't block the others. That made a
 *    *permission* failure (missing business_management, an unapproved/
 *    Advanced-Access scope, an expired partial token, ...) look IDENTICAL to
 *    "this user genuinely has zero Business Manager pages" — both produced
 *    `{ ok: true, accounts: [] }` with no error anywhere.
 *
 * 2) Once that swallowing was removed to diagnose (1), the REAL error surfaced
 *    for a real production account: "Too many subrequests by single Worker
 *    invocation" — a Cloudflare Workers platform limit, not a Facebook
 *    permission issue at all. The previous implementation issued one HTTP
 *    subrequest per Business Manager per edge (owned_pages + client_pages).
 *    A token belonging to dozens of Business Managers — completely normal for
 *    an agency admin or an established Facebook account — blows through
 *    Cloudflare's per-invocation subrequest cap. Once the cap is hit, every
 *    later call fails, silently dropping whichever businesses were iterated
 *    last. THIS explains "funciona para mim, não para um cliente com as
 *    mesmas permissões": it never depended on permissions — it depended on
 *    how many Business Managers happen to come first vs. last for each
 *    identity, which varies per account for reasons unrelated to access.
 *
 * Fix for (2): collapse the owned_pages/client_pages fan-out into Graph API's
 * own batch endpoint (graphBatch) — up to 50 Business Manager edges per single
 * HTTP call instead of one call each. Same fields, same edges, same merge —
 * only the transport changed from N requests to ceil(N/50).
 */
export declare function listLinkedPages(accessToken: string): Promise<LinkedPagesResult>;
export declare function getIgAccountInfo(igAccountId: string, accessToken: string): Promise<IgAccountInfo>;
/**
 * Same lookup as getIgAccountInfo, but for every discovered account in one
 * batch round instead of one subrequest per account — the discovery loop used
 * to await getIgAccountInfo sequentially per Page, adding one more subrequest
 * per Instagram-linked Page on top of the Business Manager fan-out above.
 * Returns a Map so callers can look up by id and fall back per-account
 * (a single account's failure must not drop the others).
 */
export declare function getIgAccountInfoBatch(igAccountIds: string[], accessToken: string): Promise<Map<string, IgAccountInfo>>;
export declare function getIgAccountInsights(igAccountId: string, accessToken: string, since: string, until: string): Promise<IgInsightSeries[]>;
export declare function getIgMedia(igAccountId: string, accessToken: string, since: string, until: string, maxItems?: number): Promise<IgMedia[]>;
export declare function getIgStories(igAccountId: string, accessToken: string): Promise<IgMedia[]>;
/**
 * Batched media/story insights — one Graph batch round (graphBatch, ceil(N/50)
 * HTTP calls) instead of one subrequest per item. Replaces the old
 * getMediaInsights loop, which cost 1 Graph API call per post plus 1 per
 * story on every sync (documented root cause of excessive Meta API volume —
 * see ADR/bug notes on Meta API rate limit consumption, 2026-08). Same
 * per-item failure isolation as getFbPostInsightsBatch/getIgAccountInfoBatch:
 * a single item's insights failing (private/restricted media, transient
 * error) returns no entry for that id, never drops the whole batch.
 */
export declare function getMediaInsightsBatch(items: Array<{
    id: string;
    mediaType: string;
    createdAt: string;
}>, accessToken: string): Promise<Map<string, IgMediaInsights>>;
export declare function getIgAudience(igAccountId: string, accessToken: string): Promise<IgAudienceEntry[]>;
export declare function getOnlineFollowers(igAccountId: string, accessToken: string): Promise<Record<string, Record<string, number>> | null>;
//# sourceMappingURL=instagram-api.d.ts.map