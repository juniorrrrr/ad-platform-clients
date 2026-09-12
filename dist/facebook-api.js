// Raw Facebook Page Graph API calls (organic Page Insights — not Meta Ads).
// Mirrors instagram-api.ts: every call throws IgApiError on API-level errors,
// and every metric is fetched in its own request so one rejected/deprecated
// metric never zeroes out the others in the same round (the same lesson
// instagram-api.ts's getIgAccountInsights already paid for — see its
// comments on chunking and per-metric isolation).
//
// IMPORTANT: unlike the Instagram Graph API (which accepts the Meta user
// token directly against the ig-business-account-id), Facebook Page
// Insights/Posts require a PAGE access token — see IgPage.access_token in
// instagram-api.ts, captured at the same discovery step that finds the
// linked Instagram account (listLinkedPages) and resolved server-side only
// (never sent to the browser — same discipline as the Meta user token).
//
// Metric names below match Meta's Graph API v21 Page Insights reference as
// of this writing. If a live call returns error code 100 ("metric[...] must
// be one of the following values..."), Meta has deprecated/renamed it for
// that Page — check https://developers.facebook.com/docs/graph-api/reference/page/insights
// and adjust here, same as every dated comment in instagram-api.ts.
import { graphBatch } from "./instagram-api";
import { graphFetch } from "./graph-fetch";
const FB_API = "https://graph.facebook.com/v21.0";
// ─── Helpers ────────────────────────────────────────────────────────────────────
const fbFetch = graphFetch;
// ─── Page Info ──────────────────────────────────────────────────────────────────
export async function getFbPageInfo(pageId, pageAccessToken) {
    const fields = "id,name,category,fan_count,picture.type(large)";
    const enc = encodeURIComponent(pageAccessToken);
    const url = `${FB_API}/${pageId}?fields=${fields}&access_token=${enc}`;
    return fbFetch(url);
}
// ─── Page Insights (time series) ─────────────────────────────────────────────────
/**
 * Each metric isolated in its own request/catch — a single rejected or
 * deprecated metric (Page Insights metrics have shifted repeatedly across
 * Graph API versions) must never take the others down with it.
 *
 * `page_fan_adds`/`page_fan_removes` foram removidas em 2026-08-13 —
 * confirmado em produção (#100 "must be a valid insights metric") e depois
 * cross-checado contra a doc oficial + fontes de terceiros que já migraram
 * suas próprias integrações: a Meta descontinuou essas duas em 15/11/2025
 * SEM substituto (ao contrário de page_fans→page_follows, aqui não existe
 * mais um "novos/perdidos seguidores por dia" via API). O crescimento de
 * seguidores agora é auto-calculado a partir do delta de fan_count entre
 * syncs — ver o passo 1 (Page info) em facebook.functions.ts.
 *
 * `page_impressions`/`page_impressions_unique` renomeadas na mesma leva
 * para `page_media_view`/`page_total_media_view_unique` — confirmado pela
 * mesma fonte.
 */
export async function getFbPageInsights(pageId, pageAccessToken, since, until) {
    const sinceTs = Math.floor(new Date(since + "T00:00:00Z").getTime() / 1000);
    const untilTs = Math.floor(new Date(until + "T23:59:59Z").getTime() / 1000);
    const enc = encodeURIComponent(pageAccessToken);
    const metricGroups = [
        ["page_media_view", "page_total_media_view_unique"],
        ["page_post_engagements"],
        // "Visitas à Página" — equivalente ao profile_views do Instagram.
        ["page_views_total"],
    ];
    const series = [];
    const errors = [];
    for (const metrics of metricGroups) {
        const url = `${FB_API}/${pageId}/insights` +
            `?metric=${metrics.join(",")}&period=day&since=${sinceTs}&until=${untilTs}` +
            `&access_token=${enc}`;
        try {
            const json = await fbFetch(url);
            series.push(...(json.data ?? []));
        }
        catch (e) {
            // Isolado por grupo de métrica — um grupo rejeitado (nome depreciado,
            // permissão insuficiente) não derruba os outros, mas o erro real
            // precisa sobreviver até a UI, não só um console.warn inacessível.
            errors.push(`Métricas (${metrics.join(",")}): ${e.message}`);
        }
    }
    return { series, errors };
}
// ─── Posts ──────────────────────────────────────────────────────────────────────
export async function getFbPagePosts(pageId, pageAccessToken, since, until, maxItems = 50) {
    // `likes.summary(true)`/`comments.summary(true)` são pedidos à parte, via
    // getFbPostEngagementBatch — confirmado ao vivo em produção (2026-08-14,
    // cliente Kimak) que a Graph API rejeita QUALQUER um dos dois com
    // "(#10) ... pages_read_engagement permission or Page Public Content
    // Access feature" (likes) / "... pages_read_user_content ..." (comments),
    // mesmo com pages_read_engagement concedida no OAuth e a conta sendo
    // admin de verdade da Página — é limite de Acesso Padrão vs. Avançado do
    // app Meta (exige App Review), não falta de escopo nem de papel na
    // Página. O problema real é que a Graph API derruba a chamada INTEIRA
    // quando qualquer campo pedido é rejeitado — sem esses dois campos aqui,
    // `shares`/`attachments`/`message`/`permalink_url`/`full_picture`
    // continuam funcionando normalmente (confirmados isolados também).
    const fields = "id,message,created_time,permalink_url,full_picture,shares,attachments{media_type,type}";
    const sinceTs = Math.floor(new Date(since + "T00:00:00Z").getTime() / 1000);
    const untilTs = Math.floor(new Date(until + "T23:59:59Z").getTime() / 1000);
    const enc = encodeURIComponent(pageAccessToken);
    let url = `${FB_API}/${pageId}/posts` +
        `?fields=${fields}&limit=25&since=${sinceTs}&until=${untilTs}` +
        `&access_token=${enc}`;
    const allPosts = [];
    while (url && allPosts.length < maxItems) {
        const json = await fbFetch(url);
        allPosts.push(...(json.data ?? []));
        url = json.paging?.next ?? "";
    }
    return allPosts.slice(0, maxItems);
}
// ─── Audience Demographics ───────────────────────────────────────────────────────
/**
 * `page_follows_city`/`page_follows_country` — renomeadas de
 * `page_fans_city`/`page_fans_country` em 15/11/2025 (confirmado em
 * produção + doc oficial), mesmo formato de chave plain-city/plain-country
 * que o Instagram legado usava, reaproveitado pela mesma parsing em
 * getFacebookDashboardData.
 *
 * `page_fans_gender_age` (idade/gênero dos seguidores) foi descontinuada na
 * mesma leva SEM substituto — confirmado tanto pelo erro real em produção
 * (#100) quanto por múltiplas fontes que já migraram suas próprias
 * integrações. Não há mais como pedir esse dado por Página; por isso não é
 * mais solicitada aqui, e a seção "Faixa etária" não aparece para Facebook
 * na UI (só para Instagram, que ainda tem follower_demographics).
 */
export async function getFbPageAudience(pageId, pageAccessToken) {
    const enc = encodeURIComponent(pageAccessToken);
    const metrics = ["page_follows_city", "page_follows_country"];
    const url = `${FB_API}/${pageId}/insights?metric=${metrics.join(",")}&period=lifetime&access_token=${enc}`;
    try {
        const json = await fbFetch(url);
        return { entries: json.data ?? [], error: null };
    }
    catch (e) {
        return { entries: [], error: e.message };
    }
}
/**
 * Batched post-level insights (impressions) — one Graph batch round for
 * every post instead of one subrequest each, same fan-out concern
 * getIgAccountInfoBatch already solves for Instagram accounts. A single
 * post's insights failing (private/restricted post, boosted-only metric,
 * etc.) must not drop the others — returns a Map, callers look up by post
 * id and fall back to "not available" per post.
 *
 * `post_engaged_users` foi removida daqui — confirmado ao vivo em produção
 * (2026-08-14, Página Kimak) que a Graph API rejeita essa métrica com
 * "(#100) The value must be a valid insights metric" mesmo pedida sozinha,
 * e a documentação oficial de Post Insights não lista mais essa métrica nem
 * indica substituto direto (os candidatos mais próximos — `post_clicks`,
 * `post_activity_by_action_type_unique`, `post_reactions_by_type_total` —
 * medem ações específicas, não "pessoas únicas engajadas" em geral; usar
 * qualquer um deles aqui seria inventar um número, não corrigir o dado).
 * Pedi-la junto de `post_media_view` (que continua válida) derrubava a
 * chamada INTEIRA para todos os posts — mesmo padrão de falha já visto e
 * corrigido em getFbPagePosts (ver comentário lá). `engaged_users` fica
 * sempre `undefined` agora; o resto do pipeline já trata isso como "não
 * disponível" (nunca um falso 0) — ver getFacebookDashboardData/SocialMediaView.
 */
export async function getFbPostInsightsBatch(postIds, pageAccessToken) {
    // post_impressions → post_media_view, mesma leva de renomeação de
    // page_impressions → page_media_view (ver getFbPageInsights acima).
    const results = await graphBatch(pageAccessToken, postIds.map((id) => `${id}/insights?metric=post_media_view`));
    const map = new Map();
    postIds.forEach((id, i) => {
        const raw = results[i]?.data;
        if (!raw)
            return;
        const out = {};
        for (const m of raw) {
            const val = m.values?.[0]?.value;
            if (val === undefined)
                continue;
            if (m.name === "post_media_view")
                out.impressions = val;
        }
        map.set(id, out);
    });
    return map;
}
/**
 * Curtidas/comentários por post — separado de getFbPagePosts (ver comentário
 * lá) porque `likes.summary(true)`/`comments.summary(true)` exigem Acesso
 * Avançado de `pages_read_engagement`/`pages_read_user_content` no app Meta
 * (App Review), que este app pode não ter — pedir esses dois campos junto
 * com o resto derruba a chamada INTEIRA de posts. Isolados aqui, uma
 * negação de permissão vira "sem dado" só para curtidas/comentários (via
 * graphBatch, que já isola falha por item), nunca a página inteira de
 * Publicações.
 */
export async function getFbPostEngagementBatch(postIds, pageAccessToken) {
    const results = await graphBatch(pageAccessToken, postIds.map((id) => `${id}?fields=likes.summary(true),comments.summary(true)`));
    const map = new Map();
    postIds.forEach((id, i) => {
        const raw = results[i];
        if (!raw)
            return;
        map.set(id, {
            likes: raw.likes?.summary?.total_count ?? 0,
            comments: raw.comments?.summary?.total_count ?? 0,
        });
    });
    return map;
}
//# sourceMappingURL=facebook-api.js.map