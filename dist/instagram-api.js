// Raw Instagram Graph API calls.
// All functions throw on non-OK HTTP or API-level errors.
import { graphFetch } from "./graph-fetch";
import { GraphApiError, withRateLimitBackoff } from "./graph-error";
const IG_API = "https://graph.facebook.com/v21.0";
// ─── Helpers ────────────────────────────────────────────────────────────────────
const igFetch = graphFetch;
// Kept as an alias so existing call sites (and their `instanceof` checks)
// keep working — the class itself now lives in graph-error.ts, shared with
// facebook-api.ts, so error classification (classifyGraphError) has one
// vocabulary instead of two near-identical error types.
export { GraphApiError as IgApiError };
/** Follows `paging.next` so accounts with >100 pages don't silently lose the tail. */
async function paginatedIgFetch(url) {
    const out = [];
    let next = url;
    while (next) {
        const json = await igFetch(next);
        out.push(...(json.data ?? []));
        next = json.paging?.next;
    }
    return out;
}
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
export async function graphBatch(accessToken, relativeUrls) {
    const chunks = [];
    for (let i = 0; i < relativeUrls.length; i += 50)
        chunks.push(relativeUrls.slice(i, i + 50));
    // Chunks are independent batch calls — run them concurrently (still just
    // ceil(N/50) subrequests total, only the wall-clock time improves).
    const chunkResults = await Promise.all(chunks.map((chunk) => withRateLimitBackoff(async () => {
        const res = await fetch(IG_API, {
            method: "POST",
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({
                access_token: accessToken,
                batch: JSON.stringify(chunk.map((relative_url) => ({ method: "GET", relative_url }))),
            }).toString(),
        });
        const json = (await res.json());
        if (!Array.isArray(json)) {
            throw new GraphApiError(json.error?.message ?? `Batch request failed (HTTP ${res.status})`, json.error?.code ?? 0, json.error?.error_subcode, res.status);
        }
        return json.map((item) => {
            if (!item || item.code !== 200)
                return null;
            try {
                return JSON.parse(item.body);
            }
            catch {
                return null;
            }
        });
    })));
    return chunkResults.flat();
}
/** Businesses (Business Manager) the token's user has any access to. */
async function listOwnedBusinesses(accessToken) {
    const enc = encodeURIComponent(accessToken);
    return paginatedIgFetch(`${IG_API}/me/businesses?fields=id,name&limit=100&access_token=${enc}`);
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
export async function listLinkedPages(accessToken) {
    const enc = encodeURIComponent(accessToken);
    const directPages = await paginatedIgFetch(`${IG_API}/me/accounts?fields=id,name,instagram_business_account,access_token,tasks&limit=100&access_token=${enc}`);
    const warnings = [];
    let businesses = [];
    try {
        businesses = await listOwnedBusinesses(accessToken);
    }
    catch (err) {
        warnings.push(`Descoberta de Business Managers falhou: ${err instanceof Error ? err.message : String(err)}`);
    }
    const businessPages = [];
    if (businesses.length > 0) {
        const relativeUrls = businesses.flatMap((b) => [
            `${b.id}/owned_pages?fields=id,name,instagram_business_account,access_token,tasks&limit=100`,
            `${b.id}/client_pages?fields=id,name,instagram_business_account,access_token,tasks&limit=100`,
        ]);
        try {
            const results = await graphBatch(accessToken, relativeUrls);
            let failedCount = 0;
            for (const result of results) {
                if (result?.data)
                    businessPages.push(...result.data);
                else
                    failedCount++;
            }
            if (failedCount > 0) {
                warnings.push(`${failedCount} de ${relativeUrls.length} consultas de Business Manager (owned_pages/client_pages) não retornaram dados. Permissão insuficiente para aquele ativo específico ou o ativo não existe mais.`);
            }
        }
        catch (err) {
            warnings.push(`Descoberta de páginas via Business Manager falhou: ${err instanceof Error ? err.message : String(err)}`);
        }
    }
    const byId = new Map();
    for (const page of [...directPages, ...businessPages])
        byId.set(page.id, page);
    return { pages: [...byId.values()], warnings };
}
// ─── Account Info ────────────────────────────────────────────────────────────────
export async function getIgAccountInfo(igAccountId, accessToken) {
    const fields = "id,name,username,profile_picture_url,followers_count,media_count,biography,website";
    const enc = encodeURIComponent(accessToken);
    const url = `${IG_API}/${igAccountId}?fields=${fields}&access_token=${enc}`;
    return igFetch(url);
}
/**
 * Same lookup as getIgAccountInfo, but for every discovered account in one
 * batch round instead of one subrequest per account — the discovery loop used
 * to await getIgAccountInfo sequentially per Page, adding one more subrequest
 * per Instagram-linked Page on top of the Business Manager fan-out above.
 * Returns a Map so callers can look up by id and fall back per-account
 * (a single account's failure must not drop the others).
 */
export async function getIgAccountInfoBatch(igAccountIds, accessToken) {
    const fields = "id,name,username,profile_picture_url,followers_count,media_count,biography,website";
    const results = await graphBatch(accessToken, igAccountIds.map((id) => `${id}?fields=${fields}`));
    const map = new Map();
    igAccountIds.forEach((id, i) => {
        const info = results[i];
        if (info)
            map.set(id, info);
    });
    return map;
}
// ─── Account Insights (time series) ─────────────────────────────────────────────
export async function getIgAccountInsights(igAccountId, accessToken, since, until) {
    // `impressions`, `email_contacts`, `phone_call_clicks` and `text_message_clicks`
    // are confirmed rejected by the Graph API for this account's User Insights
    // ("(#100) metric[0] must be one of the following values: reach, follower_count,
    // website_clicks, profile_views, online_followers, accounts_engaged, ..." — none
    // of the four appear in that list). Requesting any of them fails the ENTIRE
    // combined call, zeroing every metric in the batch, not just the invalid ones.
    //
    // `profile_views` and `website_clicks` additionally require `metric_type=total_value`
    // when combined with `period=day` ("(#100) The following metrics (profile_views,
    // website_clicks) should be specified with parameter metric_type=total_value") —
    // `reach`/`follower_count` use the default time-series metric_type — so they must
    // be fetched in two separate requests.
    //
    // `impressions` was discontinued in Graph API v22.0 (obsolete for all versions as
    // of 2025-04-21) — Meta's own docs: "We are introducing the new `views` metric
    // with `total_value` metric type ... " as its official replacement. Fetched as
    // its own call (unconfirmed whether it can share a request with profile_views/
    // website_clicks) and mapped back onto the `impressions` column.
    //
    // `period=day` additionally rejects any window wider than 30 days ("(#100) There
    // cannot be more than 30 days (2592000 s) between since and until") — so a wide
    // range (e.g. the "Máximo" date preset) must be split into ≤29-day chunks and
    // the results merged/summed, one round-trip pair per chunk.
    //
    // `follower_count` has its own, tighter window: "(#100) (follower_count) metric
    // only supports querying data for the last 30 days excluding the current day" —
    // requesting it for an older chunk fails that ENTIRE chunk's call (taking `reach`
    // down with it). It must be fetched on its own, clamped to the last 29 days.
    // Instagram Insights only accepts `since` within the last 2 years — anything older
    // is rejected outright by the Graph API ("(#100) since param is not valid"),
    // which fails the ENTIRE request (all metrics), not just the out-of-range ones.
    // Clamp instead of passing the raw app-wide date range through unchecked.
    const twoYearsAgoTs = Math.floor(Date.now() / 1000) - 729 * 86_400;
    const sinceTs = Math.max(Math.floor(new Date(since + "T00:00:00Z").getTime() / 1000), twoYearsAgoTs);
    const untilTs = Math.floor(new Date(until + "T23:59:59Z").getTime() / 1000);
    const enc = encodeURIComponent(accessToken);
    // `reach`/`profile_views`/`website_clicks`/`views` usam metric_type=total_value,
    // que devolve um total já deduplicado PARA AQUELE CHUNK — mas a Meta não oferece
    // nenhuma forma de deduplicar contas alcançadas em MAIS DE UM chunk (comprovado
    // empiricamente: duas chamadas de total_value cobrindo 01–15 e 16–29 ago somaram
    // 5,53% a mais que uma única chamada 01–29 ago no mesmo período, cliente Vicente
    // Só — ver Bug-Instagram-Metricas-Divergentes-Business-Suite.md). Cada chunk a
    // mais introduz uma nova fronteira onde esse overlap pode ocorrer, então o chunk
    // deve ser o MAIOR possível dentro do limite real da API (quase 30 dias — "There
    // cannot be more than 30 days (2592000 s) between since and until", confirmado em
    // produção), não 29 dias arredondado por baixo. Isso não elimina o overlap (só a
    // própria Meta poderia, expondo um endpoint de reach deduplicado além de 30 dias,
    // que não existe), mas minimiza o número de fronteiras — logo, o erro acumulado —
    // pra qualquer período dado.
    const CHUNK_SECONDS = 30 * 86_400 - 1;
    const chunks = [];
    for (let start = sinceTs; start <= untilTs; start += CHUNK_SECONDS + 1) {
        chunks.push({ start, end: Math.min(start + CHUNK_SECONDS, untilTs) });
    }
    const allSeries = [];
    // `reach` é métrica de contas ÚNICAS — não é somável entre dias (a mesma
    // conta alcançada em dois dias do período contaria 2x se somássemos os
    // valores diários do period=day, inflando o "Alcance" do dashboard acima
    // do número real que a Business Suite mostra). Busca o total já
    // deduplicado do CHUNK inteiro via metric_type=total_value — mesmo
    // mecanismo já usado abaixo pra profile_views/website_clicks/views, só
    // isolado na própria chamada (não documentado oficialmente pra este
    // metric_type em `reach`) com fallback pro period=day somado se a conta/
    // versão da API rejeitar, pra nunca derrubar a sync inteira por causa
    // disso.
    async function fetchChunkReach(chunkStart, chunkEnd, chunkEndIso) {
        const totalValueUrl = `${IG_API}/${igAccountId}/insights` +
            `?metric=reach&period=day&metric_type=total_value&since=${chunkStart}&until=${chunkEnd}` +
            `&access_token=${enc}`;
        try {
            const json = await igFetch(totalValueUrl);
            const raw = json.data?.[0];
            if (!raw?.total_value)
                throw new Error("resposta sem total_value");
            return [{ name: "reach", period: raw.period, values: [{ value: raw.total_value.value, end_time: chunkEndIso }] }];
        }
        catch (e) {
            console.warn("[instagram-api] reach com metric_type=total_value falhou, caindo pra period=day somado (menos preciso, contas únicas repetidas em dias diferentes contam 2x):", e.message);
            const fallbackUrl = `${IG_API}/${igAccountId}/insights?metric=reach&period=day&since=${chunkStart}&until=${chunkEnd}&access_token=${enc}`;
            try {
                const json = await igFetch(fallbackUrl);
                return json.data ?? [];
            }
            catch (e2) {
                console.warn("[instagram-api] fallback de reach (period=day) também falhou:", e2.message);
                return [];
            }
        }
    }
    for (const chunk of chunks) {
        const totalValueUrl = `${IG_API}/${igAccountId}/insights` +
            `?metric=profile_views,website_clicks&period=day&metric_type=total_value&since=${chunk.start}&until=${chunk.end}` +
            `&access_token=${enc}`;
        const viewsUrl = `${IG_API}/${igAccountId}/insights` +
            `?metric=views&period=day&metric_type=total_value&since=${chunk.start}&until=${chunk.end}` +
            `&access_token=${enc}`;
        // `metric_type=total_value` responses use a `total_value: { value }` shape instead
        // of the `values: [{ value, end_time }]` time-series shape — normalize to the
        // latter, tagged with this chunk's own end date so multiple chunks accumulate
        // into distinct daily buckets instead of overwriting each other.
        const chunkEndIso = new Date(chunk.end * 1000).toISOString().slice(0, 10) + "T00:00:00+0000";
        const normalize = (data) => data.map((s) => ({
            name: s.name,
            period: s.period,
            values: s.total_value ? [{ value: s.total_value.value, end_time: chunkEndIso }] : [],
        }));
        const [reachSeries, totalValueJson, viewsJson] = await Promise.all([
            fetchChunkReach(chunk.start, chunk.end, chunkEndIso),
            igFetch(totalValueUrl),
            igFetch(viewsUrl).catch((e) => {
                console.warn("[instagram-api] account-level views (impressions replacement) failed:", e.message);
                return { data: [] };
            }),
        ]);
        allSeries.push(...reachSeries, ...normalize(totalValueJson.data ?? []), 
        // `views` is Meta's official replacement for the discontinued account-level
        // `impressions` metric — remap the name so downstream code (which still
        // writes to the `impressions` column) needs no other changes.
        ...normalize(viewsJson.data ?? []).map((s) => ({ ...s, name: "impressions" })));
    }
    // `follower_count`: own request, clamped to the last 29 days (excluding today),
    // intersected with the caller's requested window.
    const last30Start = Math.floor(Date.now() / 1000) - 29 * 86_400;
    const followerSince = Math.max(sinceTs, last30Start);
    if (followerSince <= untilTs) {
        const followerUrl = `${IG_API}/${igAccountId}/insights` +
            `?metric=follower_count&period=day&since=${followerSince}&until=${untilTs}` +
            `&access_token=${enc}`;
        try {
            const followerJson = await igFetch(followerUrl);
            allSeries.push(...(followerJson.data ?? []));
        }
        catch (e) {
            console.warn("[instagram-api] follower_count insights failed:", e.message);
        }
    }
    return allSeries;
}
// ─── Media List ──────────────────────────────────────────────────────────────────
export async function getIgMedia(igAccountId, accessToken, since, until, maxItems = 100) {
    const fields = "id,media_type,timestamp,caption,thumbnail_url,media_url,permalink";
    const sinceTs = Math.floor(new Date(since + "T00:00:00Z").getTime() / 1000);
    const untilTs = Math.floor(new Date(until + "T23:59:59Z").getTime() / 1000);
    const enc = encodeURIComponent(accessToken);
    let url = `${IG_API}/${igAccountId}/media` +
        `?fields=${fields}&limit=50&since=${sinceTs}&until=${untilTs}` +
        `&access_token=${enc}`;
    const allMedia = [];
    while (url && allMedia.length < maxItems) {
        const json = await igFetch(url);
        allMedia.push(...(json.data ?? []));
        url = json.paging?.next ?? "";
    }
    return allMedia.slice(0, maxItems);
}
// ─── Stories ────────────────────────────────────────────────────────────────────
export async function getIgStories(igAccountId, accessToken) {
    const fields = "id,media_type,timestamp,caption,thumbnail_url,media_url,permalink";
    const enc = encodeURIComponent(accessToken);
    const url = `${IG_API}/${igAccountId}/stories?fields=${fields}&limit=100&access_token=${enc}`;
    try {
        const json = await igFetch(url);
        return json.data ?? [];
    }
    catch {
        return [];
    }
}
// ─── Media Insights ──────────────────────────────────────────────────────────────
// Per Meta's official Instagram Media Insights docs: "For media created after
// July 2, 2024, this [impressions] metric is obsolete. For media created before
// July 2, 2024, this metric will still be available." Not a blanket removal —
// scoped by content creation date.
const IMPRESSIONS_MEDIA_CUTOFF = Date.parse("2024-07-02T00:00:00Z");
// `impressions` is confirmed rejected by the Graph API for media created on/after
// the cutoff above ("(#100) Starting from version v22.0 and above, the impressions
// metric is no longer supported for the queried media") — requesting it fails the
// ENTIRE combined metrics call, so reach/likes/comments/shares/saved/
// total_interactions all get lost with it. Only request it for older media, where
// Meta's own docs confirm it's still available.
// `video_views` is likewise rejected ("metric[7] must be one of the following
// values: ... views ...") — the Graph API now calls this metric `views`.
function mediaInsightsMetrics(mediaType, createdAt) {
    const includeImpressions = Date.parse(createdAt) < IMPRESSIONS_MEDIA_CUTOFF;
    const baseMetrics = (includeImpressions ? "impressions," : "") +
        "reach,likes,comments,shares,saved,total_interactions";
    const videoExtra = ",views";
    return mediaType === "VIDEO" || mediaType === "REELS" ? baseMetrics + videoExtra : baseMetrics;
}
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
export async function getMediaInsightsBatch(items, accessToken) {
    const results = await graphBatch(accessToken, items.map((item) => `${item.id}/insights?metric=${mediaInsightsMetrics(item.mediaType, item.createdAt)}`));
    const map = new Map();
    items.forEach((item, i) => {
        const raw = results[i]?.data;
        if (!raw)
            return;
        const result = {};
        for (const m of raw) {
            const val = m.values?.[0]?.value ?? m.value ?? 0;
            const key = m.name === "views" ? "video_views" : m.name;
            result[key] = val;
        }
        map.set(item.id, result);
    });
    return map;
}
async function fetchFollowerDemographic(igAccountId, accessToken, breakdown) {
    const enc = encodeURIComponent(accessToken);
    const url = `${IG_API}/${igAccountId}/insights` +
        `?metric=follower_demographics&period=lifetime&metric_type=total_value&breakdown=${breakdown}` +
        `&access_token=${enc}`;
    try {
        const json = await igFetch(url);
        return json.data?.[0]?.total_value?.breakdowns?.[0]?.results ?? [];
    }
    catch (e) {
        console.warn(`[instagram-api] follower_demographics(${breakdown}) failed:`, e.message);
        return [];
    }
}
export async function getIgAudience(igAccountId, accessToken) {
    const [genderAge, city, country] = await Promise.all([
        fetchFollowerDemographic(igAccountId, accessToken, "gender,age"),
        fetchFollowerDemographic(igAccountId, accessToken, "city"),
        fetchFollowerDemographic(igAccountId, accessToken, "country"),
    ]);
    const toPctMap = (results, keyFromValues) => {
        const total = results.reduce((s, r) => s + r.value, 0) || 1;
        const map = {};
        for (const r of results)
            map[keyFromValues(r.dimension_values)] = (r.value / total) * 100;
        return map;
    };
    const entries = [];
    if (genderAge.length > 0) {
        // Preserve the legacy "gender.age" key format (e.g. "F.25-34") the mapper already parses.
        entries.push({
            name: "audience_gender_age",
            values: [{ value: toPctMap(genderAge, (v) => `${v[0]}.${v[1]}`) }],
        });
    }
    if (city.length > 0) {
        entries.push({ name: "audience_city", values: [{ value: toPctMap(city, (v) => v[0]) }] });
    }
    if (country.length > 0) {
        entries.push({ name: "audience_country", values: [{ value: toPctMap(country, (v) => v[0]) }] });
    }
    return entries;
}
// ─── Online Followers (activity by hour) ─────────────────────────────────────────
export async function getOnlineFollowers(igAccountId, accessToken) {
    const enc = encodeURIComponent(accessToken);
    const url = `${IG_API}/${igAccountId}/insights?metric=online_followers&period=lifetime&access_token=${enc}`;
    try {
        const json = await igFetch(url);
        const entry = json.data?.find((d) => d.name === "online_followers");
        return entry?.values?.[0]?.value ?? null;
    }
    catch {
        return null;
    }
}
//# sourceMappingURL=instagram-api.js.map