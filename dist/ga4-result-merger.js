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
// ═══════════════════════════════════════════════════════════════════════════════
// Merger Implementation
// ═══════════════════════════════════════════════════════════════════════════════
export class GA4ResultMerger {
    /**
     * Merge results from multiple queries into a single response.
     *
     * Handles three cases:
     * 1. Single query: return as-is
     * 2. Multiple metric-only queries: combine metric values
     * 3. Multiple dimensional queries: merge rows by dimension values
     */
    merge(context) {
        // Single query case - return as-is
        if (context.queries.length === 1) {
            const query = context.queries[0];
            const result = context.resultsByQueryId.get(query.id);
            if (!result) {
                throw new Error(`No result found for query ${query.id}`);
            }
            return result;
        }
        // Multiple queries - need to merge
        const hasDimensions = context.queries[0].dimensions.length > 0;
        if (hasDimensions) {
            return this.mergeDimensionalQueries(context);
        }
        else {
            return this.mergeMetricOnlyQueries(context);
        }
    }
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
    mergeMetricOnlyQueries(context) {
        // Collect all metrics in order
        const allMetrics = [];
        const allMetricIndices = new Map();
        for (const query of context.queries) {
            for (const metric of query.metrics) {
                allMetricIndices.set(metric.name, allMetrics.length);
                allMetrics.push(metric);
            }
        }
        // If all queries are empty, return empty response
        if (allMetrics.length === 0) {
            return {
                metricHeaders: [],
                rows: [],
            };
        }
        // Merge rows
        // All rows from different queries should be combined into a single row
        // since there are no dimensions to group by
        let mergedRow = null;
        for (const query of context.queries) {
            const result = context.resultsByQueryId.get(query.id);
            if (!result || !result.rows || result.rows.length === 0)
                continue;
            const queryRow = result.rows[0]; // metric-only queries have exactly one row
            if (!mergedRow) {
                // Initialize merged row with correct number of metric slots
                mergedRow = {
                    metricValues: Array(allMetrics.length).fill(null).map(() => ({ value: "0" })),
                };
            }
            // Copy metric values from this query to the merged row
            for (const [metricName, valueIdx] of query._metadata.metricIndices.entries()) {
                const mergedIdx = allMetricIndices.get(metricName);
                if (mergedIdx !== undefined && queryRow.metricValues?.[valueIdx]) {
                    if (mergedRow && mergedRow.metricValues) {
                        mergedRow.metricValues[mergedIdx] = queryRow.metricValues[valueIdx];
                    }
                }
            }
        }
        return {
            metricHeaders: allMetrics,
            rows: mergedRow ? [mergedRow] : [],
        };
    }
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
    mergeDimensionalQueries(context) {
        // Collect all dimensions and metrics in order
        const allDimensions = [];
        const allMetrics = [];
        const dimensionIndices = new Map();
        const metricIndices = new Map();
        for (const query of context.queries) {
            for (const dim of query.dimensions) {
                if (!dimensionIndices.has(dim.name)) {
                    dimensionIndices.set(dim.name, allDimensions.length);
                    allDimensions.push(dim);
                }
            }
            for (const metric of query.metrics) {
                if (!metricIndices.has(metric.name)) {
                    metricIndices.set(metric.name, allMetrics.length);
                    allMetrics.push(metric);
                }
            }
        }
        // Create a map of dimension values -> merged row
        // This allows us to combine metrics from multiple queries for the same dimension
        const rowsByDimensionKey = new Map();
        for (const query of context.queries) {
            const result = context.resultsByQueryId.get(query.id);
            if (!result || !result.rows)
                continue;
            for (const queryRow of result.rows) {
                // Build dimension key from dimension values
                const dimKey = this.buildDimensionKey(query, queryRow, dimensionIndices);
                let mergedRow = rowsByDimensionKey.get(dimKey);
                if (!mergedRow) {
                    // Create new merged row with space for all dimensions and metrics
                    mergedRow = {
                        dimensionValues: Array(allDimensions.length).fill(null).map(() => ({ value: "" })),
                        metricValues: Array(allMetrics.length).fill(null).map(() => ({ value: "0" })),
                    };
                    // Copy dimension values (same for all queries with same dimensions)
                    if (queryRow.dimensionValues) {
                        for (const [dimName, dimIdx] of query._metadata.dimensionIndices.entries()) {
                            const mergedIdx = dimensionIndices.get(dimName);
                            if (mergedIdx !== undefined && queryRow.dimensionValues[dimIdx]) {
                                mergedRow.dimensionValues[mergedIdx] = queryRow.dimensionValues[dimIdx];
                            }
                        }
                    }
                    rowsByDimensionKey.set(dimKey, mergedRow);
                }
                // Copy metric values from this query
                if (queryRow.metricValues) {
                    for (const [metricName, metricIdx] of query._metadata.metricIndices.entries()) {
                        const mergedIdx = metricIndices.get(metricName);
                        if (mergedIdx !== undefined && queryRow.metricValues[metricIdx]) {
                            mergedRow.metricValues[mergedIdx] = queryRow.metricValues[metricIdx];
                        }
                    }
                }
            }
        }
        // Convert back to array and maintain order
        const mergedRows = Array.from(rowsByDimensionKey.values());
        return {
            dimensionHeaders: allDimensions,
            metricHeaders: allMetrics,
            rows: mergedRows,
        };
    }
    /**
     * Build a unique key from dimension values to identify matching rows.
     * Used to group rows from different queries that have the same dimensions.
     */
    buildDimensionKey(query, row, dimensionIndices) {
        const parts = [];
        for (const [dimName, queryDimIdx] of query._metadata.dimensionIndices.entries()) {
            const dimValue = row.dimensionValues?.[queryDimIdx]?.value ?? "";
            parts.push(`${dimName}=${dimValue}`);
        }
        return parts.join("|");
    }
    /**
     * Validate that a merge is safe.
     * Throws if queries have incompatible configurations.
     */
    static validate(context) {
        if (context.queries.length === 0) {
            throw new Error("No queries to merge");
        }
        // All queries should have the same dimensions
        const firstDims = context.queries[0].dimensions.map(d => d.name).sort();
        for (const query of context.queries.slice(1)) {
            const queryDims = query.dimensions.map(d => d.name).sort();
            if (JSON.stringify(firstDims) !== JSON.stringify(queryDims)) {
                throw new Error("Cannot merge queries with different dimensions: " +
                    `[${firstDims.join(", ")}] vs [${queryDims.join(", ")}]`);
            }
        }
        // All queries should have the same limits/ordering
        // (for dimensional queries to make sense)
        if (context.queries[0].dimensions.length > 0) {
            const firstLimit = context.queries[0].limit;
            const firstOrder = JSON.stringify(context.queries[0].orderBys);
            for (const query of context.queries.slice(1)) {
                if (query.limit !== firstLimit) {
                    console.warn("[GA4] Warning: Queries have different row limits. Results may be inconsistent.");
                }
                if (JSON.stringify(query.orderBys) !== firstOrder) {
                    console.warn("[GA4] Warning: Queries have different ordering. Results may be inconsistent.");
                }
            }
        }
    }
}
export const ga4ResultMerger = new GA4ResultMerger();
//# sourceMappingURL=ga4-result-merger.js.map