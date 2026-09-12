/**
 * GA4 Result Merger
 *
 * Consolidates results from multiple GA4 queries back into the format
 * expected by the rest of the system.
 *
 * When a large result set is split across multiple queries, the merger:
 * - Combines rows from all queries
 * - Handles dimension-only queries (no metrics merged)
 * - Handles metric-only queries (no dimensions merged)
 * - Handles dimensional+metric queries (rows merged on dimensions)
 * - Preserves the original response structure
 *
 * Key principle: The mapper receives exactly the same object structure
 * as it would have from a single query. Zero changes needed downstream.
 */
import type { GA4ReportResponse } from "./ga4-batch-executor";
import type { GA4Query } from "./ga4-query-planner";
export interface MergeContext {
    /** Original queries that were executed */
    queries: GA4Query[];
    /** Results from batch executor, keyed by query ID */
    resultsByQueryId: Map<string, GA4ReportResponse>;
}
export declare class GA4ResultMerger {
    /**
     * Merge results from multiple queries into a single response.
     *
     * Handles three cases:
     * 1. Single query: return as-is
     * 2. Multiple metric-only queries: combine metric values
     * 3. Multiple dimensional queries: merge rows by dimension values
     */
    merge(context: MergeContext): GA4ReportResponse;
    /**
     * Merge multiple metric-only queries into a single summary row.
     * Example: when metrics exceed 10, split into 2 queries, then merge.
     *
     * Input:
     *   Query 1: metrics: [totalUsers, newUsers, sessions, ...]
     *   Query 2: metrics: [addToCarts, checkouts]
     *
     * Output:
     *   Single row with all metrics in order: [totalUsers, newUsers, ..., addToCarts, checkouts]
     */
    private mergeMetricOnlyQueries;
    /**
     * Merge multiple dimensional queries.
     *
     * When dimensions + many metrics cause splits, we need to merge rows.
     * Example: dimensions=[date], metrics=[sessions, users, revenue, ...]
     *
     * Input (if split into 2 queries):
     *   Query 1: dimensions=[date], metrics=[sessions, users, ...]
     *   Query 2: dimensions=[date], metrics=[conversions, ...]
     *
     * For each date:
     *   - Combine metric values from both queries
     *   - Maintain dimension value from either query (they're identical)
     *
     * Output:
     *   Single set of rows with all dimensions and metrics
     */
    private mergeDimensionalQueries;
    /**
     * Build a unique key from dimension values to identify matching rows.
     * Used to group rows from different queries that have the same dimensions.
     */
    private buildDimensionKey;
    /**
     * Validate that a merge is safe.
     * Throws if queries have incompatible configurations.
     */
    static validate(context: MergeContext): void;
}
export declare const ga4ResultMerger: GA4ResultMerger;
//# sourceMappingURL=ga4-result-merger.d.ts.map