/**
 * GA4 Batch Executor
 *
 * Executes multiple GA4 queries in parallel with:
 * - Automatic retry logic for transient failures
 * - Rate limit handling
 * - Comprehensive error reporting
 * - Result consolidation ready for merging
 *
 * Takes a GA4QueryPlan and executes all queries, hiding the multiplicity
 * from callers. Results are returned in a format ready for merging.
 */

import type { GA4Query, GA4QueryPlan } from "./ga4-query-planner";

export interface GA4ReportResponse {
  dimensionHeaders?: { name: string }[];
  metricHeaders?: { name: string }[];
  rows?: GA4ReportRow[];
  error?: { message: string };
  metadata?: {
    // Total rows before limit applied
    rowCount?: number;
    isDataGolden?: boolean;
  };
}

export interface GA4ReportRow {
  dimensionValues?: { value: string }[];
  metricValues?: { value: string }[];
}

export interface BatchExecutionResult {
  /** Results keyed by query ID */
  results: Map<string, GA4ReportResponse>;
  /** Any errors that occurred during execution */
  errors: Map<string, Error>;
  /** Total requests made */
  totalRequests: number;
  /** Total retries performed */
  totalRetries: number;
}

export interface BatchExecutionOptions {
  /** Maximum retries per query on transient failures */
  maxRetries?: number;
  /** Delay between retries in ms */
  retryDelayMs?: number;
  /** Timeout per query in ms */
  queryTimeoutMs?: number;
}

const DEFAULT_OPTIONS: Required<BatchExecutionOptions> = {
  maxRetries: 3,
  retryDelayMs: 1000,
  queryTimeoutMs: 30_000,
};

// ═══════════════════════════════════════════════════════════════════════════════
// Batch Executor Implementation
// ═══════════════════════════════════════════════════════════════════════════════

export class GA4BatchExecutor {
  private readonly GA4_DATA_BASE = "https://analyticsdata.googleapis.com/v1beta";
  private readonly options: Required<BatchExecutionOptions>;

  constructor(options: BatchExecutionOptions = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Execute all queries in a plan in parallel.
   * Returns consolidated results and any errors that occurred.
   */
  async executePlan(
    plan: GA4QueryPlan,
    propertyId: string,
    accessToken: string,
    dateRanges: Array<{ startDate: string; endDate: string }>,
  ): Promise<BatchExecutionResult> {
    const results = new Map<string, GA4ReportResponse>();
    const errors = new Map<string, Error>();
    let totalRequests = 0;
    let totalRetries = 0;

    // Execute all queries in parallel
    const executions = plan.queries.map(async (query) => {
      try {
        const { result, retries, requests } = await this.executeQueryWithRetry(
          query,
          propertyId,
          accessToken,
          dateRanges,
        );
        results.set(query.id, result);
        totalRetries += retries;
        totalRequests += requests;
      } catch (err) {
        errors.set(query.id, err instanceof Error ? err : new Error(String(err)));
      }
    });

    await Promise.all(executions);

    return {
      results,
      errors,
      totalRequests,
      totalRetries,
    };
  }

  /**
   * Execute a single query with automatic retry logic.
   * Returns the result, number of retries, and total requests made.
   */
  private async executeQueryWithRetry(
    query: GA4Query,
    propertyId: string,
    accessToken: string,
    dateRanges: Array<{ startDate: string; endDate: string }>,
  ): Promise<{ result: GA4ReportResponse; retries: number; requests: number }> {
    let lastError: Error | null = null;
    let attempts = 0;

    for (let i = 0; i <= this.options.maxRetries; i++) {
      attempts++;
      try {
        const result = await this.executeQuery(
          query,
          propertyId,
          accessToken,
          dateRanges,
        );

        // Check for API errors in response
        if (result.error) {
          const errorMsg = result.error.message || "Unknown GA4 API error";
          throw new Error(`GA4 API Error: ${errorMsg}`);
        }

        return {
          result,
          retries: i,
          requests: attempts,
        };
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        // Check if error is retryable
        if (!this.isRetryable(lastError) || i === this.options.maxRetries) {
          throw lastError;
        }

        // Wait before retrying
        const delay = this.options.retryDelayMs * Math.pow(2, i); // exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }

    throw lastError || new Error("Unknown error during query execution");
  }

  /**
   * Execute a single GA4 query without retry logic.
   */
  private async executeQuery(
    query: GA4Query,
    propertyId: string,
    accessToken: string,
    dateRanges: Array<{ startDate: string; endDate: string }>,
  ): Promise<GA4ReportResponse> {
    const url = `${this.GA4_DATA_BASE}/properties/${propertyId}:runReport`;

    const body = {
      dateRanges,
      metrics: query.metrics,
      dimensions: query.dimensions.length > 0 ? query.dimensions : undefined,
      limit: query.limit,
      orderBys: query.orderBys,
      dimensionFilter: query.dimensionFilter,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.options.queryTimeoutMs);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      const json = (await response.json()) as GA4ReportResponse;

      if (!response.ok) {
        throw new Error(
          json.error?.message ?? `GA4 API error (${response.status})`
        );
      }

      return json;
    } catch (err) {
      clearTimeout(timeoutId);
      throw err;
    }
  }

  /**
   * Determine if an error is retryable.
   * Transient errors (timeouts, rate limits) are retryable.
   * Permanent errors (auth, invalid metrics) are not.
   */
  private isRetryable(error: Error): boolean {
    const msg = error.message.toLowerCase();

    // Retryable errors
    if (msg.includes("timeout") || msg.includes("aborted")) return true;
    if (msg.includes("429") || msg.includes("rate limit")) return true;
    if (msg.includes("503") || msg.includes("service unavailable")) return true;
    if (msg.includes("500") || msg.includes("internal error")) return true;

    // Non-retryable errors
    if (msg.includes("401") || msg.includes("unauthorized")) return false;
    if (msg.includes("403") || msg.includes("forbidden")) return false;
    if (msg.includes("404") || msg.includes("not found")) return false;
    if (msg.includes("invalid argument")) return false;
    if (msg.includes("unrecognized field")) return false;

    // Default to non-retryable for safety
    return false;
  }

  /**
   * Get execution statistics for logging/debugging.
   */
  static formatStats(result: BatchExecutionResult): string {
    return [
      `Total requests: ${result.totalRequests}`,
      `Total retries: ${result.totalRetries}`,
      `Successful queries: ${result.results.size}`,
      `Failed queries: ${result.errors.size}`,
    ].join(" | ");
  }
}

export const ga4BatchExecutor = new GA4BatchExecutor();
