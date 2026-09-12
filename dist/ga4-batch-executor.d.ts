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
import type { GA4QueryPlan } from "./ga4-query-planner";
export interface GA4ReportResponse {
    dimensionHeaders?: {
        name: string;
    }[];
    metricHeaders?: {
        name: string;
    }[];
    rows?: GA4ReportRow[];
    error?: {
        message: string;
    };
    metadata?: {
        rowCount?: number;
        isDataGolden?: boolean;
    };
}
export interface GA4ReportRow {
    dimensionValues?: {
        value: string;
    }[];
    metricValues?: {
        value: string;
    }[];
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
export declare class GA4BatchExecutor {
    private readonly GA4_DATA_BASE;
    private readonly options;
    constructor(options?: BatchExecutionOptions);
    /**
     * Execute all queries in a plan in parallel.
     * Returns consolidated results and any errors that occurred.
     */
    executePlan(plan: GA4QueryPlan, propertyId: string, accessToken: string, dateRanges: Array<{
        startDate: string;
        endDate: string;
    }>): Promise<BatchExecutionResult>;
    /**
     * Execute a single query with automatic retry logic.
     * Returns the result, number of retries, and total requests made.
     */
    private executeQueryWithRetry;
    /**
     * Execute a single GA4 query without retry logic.
     */
    private executeQuery;
    /**
     * Determine if an error is retryable.
     * Transient errors (timeouts, rate limits) are retryable.
     * Permanent errors (auth, invalid metrics) are not.
     */
    private isRetryable;
    /**
     * Get execution statistics for logging/debugging.
     */
    static formatStats(result: BatchExecutionResult): string;
}
export declare const ga4BatchExecutor: GA4BatchExecutor;
//# sourceMappingURL=ga4-batch-executor.d.ts.map