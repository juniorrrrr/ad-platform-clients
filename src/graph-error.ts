// Shared error classification for every Graph API call (Facebook Ads, Facebook
// Page Insights, Instagram) — see "Facebook Graph API — Architecture Review"
// (DASH B2DCOM/03 Arquitetura/) for the full audit this implements §3.1.
//
// Before this module, `IgApiError`/errors from facebook-api.ts carried only a
// numeric `code` and every catch site downstream (syncFacebookData,
// syncInstagramData) discarded it into `(e as Error).message` — there was no
// way to act differently on an expired token vs. a rate limit vs. a
// permission ceiling. classifyGraphError() is the single place that decision
// gets made, so recovery logic (graph-recovery.ts) never has to re-derive it.

// `RESOURCE_STALE` is never returned by classifyGraphError() itself — the raw
// Graph API error shape (code/subcode/message) can't distinguish "this scope
// was never granted" from "this specific cached page_id/token used to work
// and just stopped". That distinction depends on context classifyGraphError
// doesn't have: whether the failing call is a per-account cached resolution
// vs. a connection's own discovery. graph-recovery.ts makes that call — when
// a TOKEN_INVALID/PERMISSION_MISSING_SCOPE happens against a resource that
// previously validated successfully, it re-labels it RESOURCE_STALE and
// re-discovers instead of asking for reconnection outright. Kept in this
// union so both modules share one vocabulary.
export type GraphErrorClass =
  | "TOKEN_INVALID"
  | "RATE_LIMITED"
  | "PERMISSION_MISSING_SCOPE"
  | "PERMISSION_ADVANCED_ACCESS"
  | "RESOURCE_STALE"
  | "TRANSIENT"
  | "UNKNOWN";

export class GraphApiError extends Error {
  constructor(
    message: string,
    public readonly code: number,
    public readonly subcode?: number,
    public readonly httpStatus?: number,
  ) {
    super(message);
    this.name = "GraphApiError";
  }
}

// ─── Meta's own error code reference ───────────────────────────────────────
// https://developers.facebook.com/docs/graph-api/guides/error-handling
//
// 190          OAuthException — access token invalid/expired
// 102          API Session — session key invalid or no longer valid
// 463          Session has expired
// subcodes 458/459/460/463/467 under 190 — revoked/checkpointed/password
//   changed/expired/invalid, respectively (Meta reuses 463 as both a
//   top-level code and a 190 subcode depending on API surface)
const TOKEN_INVALID_CODES = new Set([190, 102, 463]);
const TOKEN_INVALID_SUBCODES = new Set([458, 459, 460, 463, 467]);

// 4    Application request limit reached
// 17   User request limit reached
// 32   Page request limit reached
// 613  Custom rate limit (Ads/Marketing API)
const RATE_LIMIT_CODES = new Set([4, 17, 32, 613]);

// 10   Permission denied for this action/edge
// 200  Generic permission error (legacy, still seen on some Page edges)
const PERMISSION_CODES = new Set([10, 200]);

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

interface RawUsageFields {
  call_count?: number;
  total_cputime?: number;
  total_time?: number;
}

function normalizeUsage(raw: RawUsageFields | undefined): RateLimitUsage | null {
  if (!raw) return null;
  return { callCount: raw.call_count, totalCputime: raw.total_cputime, totalTime: raw.total_time };
}

export function parseRateLimitHeaders(headers: Headers): RateLimitUsage | null {
  // X-App-Usage is a flat object: {"call_count":28,"total_cputime":25,"total_time":25}
  const appUsage = headers.get("x-app-usage");
  if (appUsage) {
    try {
      return normalizeUsage(JSON.parse(appUsage) as RawUsageFields);
    } catch {
      return null;
    }
  }

  // X-Business-Use-Case-Usage is keyed by business id, each value an array
  // of per-use-case usage objects: {"<business_id>":[{"call_count":...}]} —
  // flatten to the first (only, in practice, for a single ad account's
  // token) entry.
  const buc = headers.get("x-business-use-case-usage");
  if (buc) {
    try {
      const parsed = JSON.parse(buc) as Record<string, RawUsageFields[]>;
      const firstBucket = Object.values(parsed)[0];
      return normalizeUsage(firstBucket?.[0]);
    } catch {
      return null;
    }
  }

  return null;
}

/** True once any usage bucket crosses this percentage — matches the ~79% the app already hit once (see Bug-Consumo-Excessivo-Meta-API-79-Porcento). */
export function isApproachingRateLimit(usage: RateLimitUsage | null, thresholdPct = 80): boolean {
  if (!usage) return false;
  return [usage.callCount, usage.totalCputime, usage.totalTime].some(
    (v) => typeof v === "number" && v >= thresholdPct,
  );
}

/**
 * Best-effort extraction of the permission name a Graph API error message
 * references (e.g. "... requires the 'pages_read_engagement' permission ...").
 * Used to distinguish PERMISSION_MISSING_SCOPE (never asked for this scope)
 * from PERMISSION_ADVANCED_ACCESS (scope granted, but the app's Standard
 * Access tier doesn't cover this field/edge — reconnecting can't fix that,
 * only an approved App Review submission can).
 */
function extractScopeFromMessage(message: string): string | null {
  const match =
    message.match(/'([a-z_]+)'\s+permission/i) ?? message.match(/permission\s+'([a-z_]+)'/i);
  return match?.[1] ?? null;
}

export function classifyGraphError(
  err: unknown,
  grantedScopes?: readonly string[] | null,
): GraphErrorClass {
  if (!(err instanceof GraphApiError)) return "TRANSIENT";

  if (err.httpStatus === 429) return "RATE_LIMITED";
  if (err.httpStatus !== undefined && err.httpStatus >= 500) return "TRANSIENT";

  if (RATE_LIMIT_CODES.has(err.code)) return "RATE_LIMITED";

  if (
    TOKEN_INVALID_CODES.has(err.code) ||
    (err.subcode !== undefined && TOKEN_INVALID_SUBCODES.has(err.subcode))
  ) {
    return "TOKEN_INVALID";
  }

  if (PERMISSION_CODES.has(err.code)) {
    const scope = extractScopeFromMessage(err.message);
    if (scope && grantedScopes && !grantedScopes.includes(scope)) {
      return "PERMISSION_MISSING_SCOPE";
    }
    // Either the scope IS granted (Standard vs. Advanced Access ceiling —
    // see Bug-Facebook-Posts-Permissao-Conteudo-Insuficiente.md) or we
    // couldn't tell which scope is missing — default to the safer bucket
    // that does NOT get retried every sync, since a wrong guess here means
    // hammering a wall that reconnecting can never fix.
    return "PERMISSION_ADVANCED_ACCESS";
  }

  return "UNKNOWN";
}

export function isTokenInvalid(err: unknown): boolean {
  return classifyGraphError(err) === "TOKEN_INVALID";
}

export function isRateLimited(err: unknown): boolean {
  return classifyGraphError(err) === "RATE_LIMITED";
}

export function isPermissionError(err: unknown): boolean {
  const cls = classifyGraphError(err);
  return cls === "PERMISSION_MISSING_SCOPE" || cls === "PERMISSION_ADVANCED_ACCESS";
}

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
export async function withRateLimitBackoff<T>(
  fn: () => Promise<T>,
  opts: { maxAttempts?: number; baseDelayMs?: number } = {},
): Promise<T> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const baseDelayMs = opts.baseDelayMs ?? 2000;
  let lastErr: unknown;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (classifyGraphError(e) !== "RATE_LIMITED") throw e;
      if (attempt === maxAttempts - 1) break;
      const delay = baseDelayMs * 2 ** attempt + Math.random() * baseDelayMs;
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw lastErr;
}
