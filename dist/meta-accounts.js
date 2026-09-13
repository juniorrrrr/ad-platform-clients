"use strict";
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
Object.defineProperty(exports, "__esModule", { value: true });
exports.fetchAllMetaAdAccounts = fetchAllMetaAdAccounts;
const META_API_VERSION = "v21.0";
const FIELDS = "account_id,name,currency,account_status,timezone_name,business{id,name}";
// ─── Pagination ────────────────────────────────────────────────────────────────
async function fetchAllPages(initialUrl, label, throwOnFirstError = false) {
    const results = [];
    let nextUrl = initialUrl;
    let page = 0;
    while (nextUrl) {
        const res = await fetch(nextUrl);
        const json = (await res.json());
        if (!res.ok || json.error) {
            const msg = json.error?.message ?? `HTTP ${res.status}`;
            if (page === 0 && throwOnFirstError)
                throw new Error(msg);
            console.warn(`[meta-accounts] ${label} p${page} falhou:`, msg);
            break;
        }
        const batch = json.data ?? [];
        results.push(...batch);
        console.log(`[meta-accounts] ${label} p${page}: ${batch.length} itens`);
        nextUrl = json.paging?.next ?? null;
        page++;
    }
    return results;
}
async function fetchSafe(url, label) {
    try {
        return await fetchAllPages(url, label, false);
    }
    catch (err) {
        console.warn(`[meta-accounts] ${label} ignorado:`, err);
        return [];
    }
}
// ─── Normalise ────────────────────────────────────────────────────────────────
function normalise(raw, bizOverride) {
    // `id` always comes back as "act_XXXXX"; `account_id` is the numeric-only fallback
    const accountId = raw.id?.startsWith("act_")
        ? raw.id
        : raw.id
            ? `act_${raw.id}`
            : `act_${raw.account_id ?? "unknown"}`;
    return {
        accountId,
        name: raw.name ?? `Conta ${raw.account_id ?? raw.id}`,
        currency: raw.currency ?? "BRL",
        accountStatus: raw.account_status ?? 1,
        timezoneName: raw.timezone_name ?? "",
        businessId: bizOverride?.id ?? raw.business?.id ?? null,
        businessName: bizOverride?.name ?? raw.business?.name ?? null,
    };
}
// ─── Main export ──────────────────────────────────────────────────────────────
async function fetchAllMetaAdAccounts(token) {
    const enc = encodeURIComponent(token);
    // ── Step 1: direct accounts (THROWS on failure — primary source) ───────────
    const directRaw = await fetchAllPages(`https://graph.facebook.com/${META_API_VERSION}/me/adaccounts?fields=${FIELDS}&limit=200&access_token=${enc}`, "me/adaccounts", true);
    console.log(`STEP 1 - Meta API (diretas): ${directRaw.length}`);
    // ── Step 2: businesses (optional — missing scope = empty, not an error) ─────
    const businesses = await fetchSafe(`https://graph.facebook.com/${META_API_VERSION}/me/businesses?fields=id,name&limit=50&access_token=${enc}`, "me/businesses");
    console.log(`[meta-accounts] Step 2 total: ${businesses.length} businesses`);
    // ── Step 3: owned + client accounts for every business (parallel) ──────────
    const businessGroups = await Promise.all(businesses.map(async (biz) => {
        const [owned, clients] = await Promise.all([
            fetchSafe(`https://graph.facebook.com/${META_API_VERSION}/${biz.id}/owned_ad_accounts?fields=${FIELDS}&limit=200&access_token=${enc}`, `biz:${biz.name}/owned`),
            fetchSafe(`https://graph.facebook.com/${META_API_VERSION}/${biz.id}/client_ad_accounts?fields=${FIELDS}&limit=200&access_token=${enc}`, `biz:${biz.name}/clients`),
        ]);
        console.log(`[meta-accounts] BM "${biz.name}": ${owned.length} owned, ${clients.length} client`);
        return [...owned, ...clients].map((a) => normalise(a, biz));
    }));
    // ── Step 4: merge all sources ─────────────────────────────────────────────
    const all = [
        ...directRaw.map((a) => normalise(a)),
        ...businessGroups.flat(),
    ];
    console.log(`STEP 2 - Após merge: ${all.length}`);
    // ── Step 5: deduplicate by accountId ─────────────────────────────────────
    const seen = new Set();
    const unique = all.filter((a) => {
        if (seen.has(a.accountId))
            return false;
        seen.add(a.accountId);
        return true;
    });
    console.log(`STEP 3 - Após dedup: ${unique.length}`);
    // ── Step 6: exclude only truly CLOSED accounts (status 101) ─────────────
    // Accounts with status 3/7/8/9/100 are accessible and must appear.
    const available = unique.filter((a) => a.accountStatus !== 101);
    console.log(`STEP 4 - Após filtros (excl. closed): ${available.length}`);
    // ── Step 7: sort alphabetically ───────────────────────────────────────────
    available.sort((a, b) => a.name.localeCompare(b.name, "pt-BR", { sensitivity: "base" }));
    console.log("Contas encontradas:", available);
    console.log("Total:", available.length);
    return available;
}
//# sourceMappingURL=meta-accounts.js.map