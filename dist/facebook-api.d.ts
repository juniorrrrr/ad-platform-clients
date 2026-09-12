export interface FbPageInfo {
    id: string;
    name: string;
    category?: string;
    fan_count: number;
    picture?: {
        data?: {
            url?: string;
        };
    };
}
export interface FbInsightValue {
    value: number;
    end_time: string;
}
export interface FbInsightSeries {
    name: string;
    period: string;
    values: FbInsightValue[];
}
export interface FbPost {
    id: string;
    message?: string;
    created_time: string;
    permalink_url?: string;
    full_picture?: string;
    shares?: {
        count: number;
    };
    /** `type` was deprecated for Page posts years ago — `attachments.data[0].media_type`/`type` is the current source for "foto/vídeo/link". */
    attachments?: {
        data?: Array<{
            media_type?: string;
            type?: string;
        }>;
    };
}
export interface FbPostEngagement {
    likes: number;
    comments: number;
}
export interface FbAudienceEntry {
    name: string;
    values: Array<{
        value: Record<string, number>;
    }>;
}
export interface FbPostInsights {
    impressions?: number;
    engaged_users?: number;
}
export declare function getFbPageInfo(pageId: string, pageAccessToken: string): Promise<FbPageInfo>;
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
export declare function getFbPageInsights(pageId: string, pageAccessToken: string, since: string, until: string): Promise<{
    series: FbInsightSeries[];
    errors: string[];
}>;
export declare function getFbPagePosts(pageId: string, pageAccessToken: string, since: string, until: string, maxItems?: number): Promise<FbPost[]>;
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
export declare function getFbPageAudience(pageId: string, pageAccessToken: string): Promise<{
    entries: FbAudienceEntry[];
    error: string | null;
}>;
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
export declare function getFbPostInsightsBatch(postIds: string[], pageAccessToken: string): Promise<Map<string, FbPostInsights>>;
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
export declare function getFbPostEngagementBatch(postIds: string[], pageAccessToken: string): Promise<Map<string, FbPostEngagement>>;
//# sourceMappingURL=facebook-api.d.ts.map