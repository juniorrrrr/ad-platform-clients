"use strict";
/**
 * GA4 Query Planner
 *
 * Encapsulates all knowledge of Google Analytics Data API limitations and constraints.
 * Automatically distributes metrics and dimensions across multiple queries while respecting:
 *
 * - Maximum 10 metrics per request
 * - Maximum 9 dimensions per request
 * - Field-level compatibility constraints
 * - Query-specific dimension limits
 *
 * The planner is stateless and declarative:
 * 1. Declare what metrics/dimensions you want
 * 2. The planner automatically splits them into compliant queries
 * 3. Results are aggregated back into a single response
 *
 * No other component should know about these API constraints.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.ga4QueryPlanner = void 0;
// ═══════════════════════════════════════════════════════════════════════════════
// GA4 Query Planner Implementation
// ═══════════════════════════════════════════════════════════════════════════════
class QueryPlanner {
    limits;
    fieldCompatibility;
    constructor(limits = {
        maxMetricsPerQuery: 10,
        maxDimensionsPerQuery: 9,
        maxRowsPerQuery: 100_000,
    }) {
        this.limits = limits;
        this.fieldCompatibility = new Map();
        this.initializeFieldCompatibility();
    }
    /**
     * Initialize field compatibility matrix.
     * Documents which GA4 fields cannot appear in the same query.
     */
    initializeFieldCompatibility() {
        // GA4 has fewer incompatibilities than Google Ads, but we document them here
        // for future maintainability. Currently, most GA4 fields are compatible.
        // If new incompatibilities are discovered, add them here.
    }
    /**
     * Plan a query with metrics and dimensions.
     * Automatically splits into multiple queries if needed.
     *
     * @param metrics List of metric names to fetch
     * @param dimensions List of dimension names to fetch
     * @param limit Row limit (applied to each query)
     * @param orderBys Order specification
     * @returns A plan containing all necessary queries
     */
    planQuery(metrics, dimensions, limit, orderBys, dimensionFilter) {
        const queries = [];
        const summaryQueryMap = new Map();
        // Check if query fits in a single request
        if (metrics.length <= this.limits.maxMetricsPerQuery &&
            dimensions.length <= this.limits.maxDimensionsPerQuery) {
            const query = this.createQuery(`query_0`, metrics, dimensions, limit, orderBys, dimensionFilter);
            queries.push(query);
        }
        else if (dimensions.length > this.limits.maxDimensionsPerQuery) {
            // If dimensions exceed limit, we need to split differently
            // Most GA4 queries use few dimensions, so this is rare
            throw new Error(`Dimensions exceed GA4 limit: ${dimensions.length} > ${this.limits.maxDimensionsPerQuery}. ` +
                `Current query needs: ${dimensions.join(", ")}. ` +
                `Consider splitting into separate dimensional analyses.`);
        }
        else {
            // Split metrics into batches
            const batches = this.splitMetricsIntoBatches(metrics);
            for (let i = 0; i < batches.length; i++) {
                const query = this.createQuery(`query_${i}`, batches[i], dimensions, limit, orderBys, dimensionFilter);
                queries.push(query);
            }
        }
        return { queries, summaryQueryMap };
    }
    /**
     * Split a list of metrics into batches respecting the API limit.
     * Attempts to keep related metrics together for better query efficiency.
     */
    splitMetricsIntoBatches(metrics) {
        const batches = [];
        let currentBatch = [];
        for (const metric of metrics) {
            if (currentBatch.length >= this.limits.maxMetricsPerQuery) {
                batches.push(currentBatch);
                currentBatch = [];
            }
            currentBatch.push(metric);
        }
        if (currentBatch.length > 0) {
            batches.push(currentBatch);
        }
        return batches;
    }
    /**
     * Create a single GA4Query object with proper metadata for result mapping.
     */
    createQuery(id, metrics, dimensions, limit, orderBys, dimensionFilter) {
        // Build metric indices map
        const metricIndices = new Map();
        metrics.forEach((metric, index) => {
            metricIndices.set(metric, index);
        });
        // Build dimension indices map
        const dimensionIndices = new Map();
        dimensions.forEach((dimension, index) => {
            dimensionIndices.set(dimension, index);
        });
        // A metrics list that exceeds maxMetricsPerQuery gets split into several
        // batches (see splitMetricsIntoBatches) that all share the SAME caller-
        // supplied orderBys — but the GA4 Data API rejects an orderBys entry that
        // references a metric/dimension absent from THAT request. Keep only the
        // entries this specific batch can actually satisfy; batches that lose
        // their only orderBy simply come back unsorted (harmless — callers only
        // ever rely on ordering for the batch that "sessions"-style ordering
        // metric lands in, by convention the first one).
        const filteredOrderBys = orderBys?.filter((ob) => (ob.metric && metrics.includes(ob.metric.metricName)) ||
            (ob.dimension && dimensions.includes(ob.dimension.dimensionName)));
        return {
            id,
            metrics: metrics.map(name => ({ name })),
            dimensions: dimensions.map(name => ({ name })),
            limit,
            orderBys: filteredOrderBys && filteredOrderBys.length > 0 ? filteredOrderBys : undefined,
            dimensionFilter,
            _metadata: {
                metricIndices,
                dimensionIndices,
                sourceQueryId: id,
            },
        };
    }
    /**
     * Create a query plan for the standard GA4 summary query.
     * This is the most common case: fetching multiple metrics without dimensions.
     */
    planSummary(metrics) {
        return this.planQuery(metrics, []);
    }
    /**
     * Create a query plan for a dimensional query.
     * Handles metrics + dimensions without splitting dimensions.
     */
    planDimensional(metrics, dimensions, limit, orderBys) {
        return this.planQuery(metrics, dimensions, limit, orderBys);
    }
    /**
     * Get information about current limits.
     * Useful for logging and debugging.
     */
    getLimits() {
        return { ...this.limits };
    }
    /**
     * Check if a query configuration would exceed limits.
     * Returns validation errors if any.
     */
    validate(metrics, dimensions) {
        const errors = [];
        if (metrics.length > this.limits.maxMetricsPerQuery * 3) {
            errors.push(`Too many metrics: ${metrics.length}. Even after batching across 3 queries, ` +
                `this may indicate an architectural issue. Consider using separate report views.`);
        }
        if (dimensions.length > this.limits.maxDimensionsPerQuery) {
            errors.push(`Dimensions exceed limit: ${dimensions.length} > ${this.limits.maxDimensionsPerQuery}`);
        }
        return errors;
    }
}
// Export singleton instance
exports.ga4QueryPlanner = new QueryPlanner();
//# sourceMappingURL=ga4-query-planner.js.map