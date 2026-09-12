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
export interface GA4MetricDef {
    name: string;
    type: "metric" | "dimension";
    /** If true, this field cannot be combined with certain other fields */
    requiresIsolation?: boolean;
    /** List of metric names this field is incompatible with */
    incompatibleWith?: string[];
}
export interface GA4QueryLimits {
    maxMetricsPerQuery: number;
    maxDimensionsPerQuery: number;
    maxRowsPerQuery: number;
}
/** Loose mirror of the GA4 Data API's FilterExpression — only the shapes this codebase builds. */
export interface GA4FilterExpression {
    orGroup?: {
        expressions: GA4FilterExpression[];
    };
    andGroup?: {
        expressions: GA4FilterExpression[];
    };
    filter?: {
        fieldName: string;
        stringFilter?: {
            matchType: "EXACT" | "BEGINS_WITH" | "ENDS_WITH" | "CONTAINS" | "FULL_REGEXP" | "PARTIAL_REGEXP";
            value: string;
            caseSensitive?: boolean;
        };
    };
}
export interface GA4Query {
    /** Unique identifier for this query batch */
    id: string;
    /** Metrics to fetch in this query */
    metrics: Array<{
        name: string;
    }>;
    /** Dimensions to fetch in this query */
    dimensions: Array<{
        name: string;
    }>;
    /** Row limit for this query */
    limit?: number;
    /** Order by specification */
    orderBys?: Array<{
        metric?: {
            metricName: string;
        };
        dimension?: {
            dimensionName: string;
        };
        desc?: boolean;
    }>;
    /** Restricts which rows count toward the metrics (e.g. pagePath CONTAINS a cart/checkout URL pattern). */
    dimensionFilter?: GA4FilterExpression;
    /** Metadata for mapping results back to original request */
    _metadata: {
        metricIndices: Map<string, number>;
        dimensionIndices: Map<string, number>;
        sourceQueryId: string;
    };
}
export interface GA4QueryPlan {
    queries: GA4Query[];
    /** Maps query id to which row contains the summary (if any) */
    summaryQueryMap: Map<string, {
        queryId: string;
        rowIndex: number;
    }>;
}
declare class QueryPlanner {
    private limits;
    private fieldCompatibility;
    constructor(limits?: GA4QueryLimits);
    /**
     * Initialize field compatibility matrix.
     * Documents which GA4 fields cannot appear in the same query.
     */
    private initializeFieldCompatibility;
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
    planQuery(metrics: string[], dimensions: string[], limit?: number, orderBys?: Array<{
        metric?: {
            metricName: string;
        };
        dimension?: {
            dimensionName: string;
        };
        desc?: boolean;
    }>, dimensionFilter?: GA4FilterExpression): GA4QueryPlan;
    /**
     * Split a list of metrics into batches respecting the API limit.
     * Attempts to keep related metrics together for better query efficiency.
     */
    private splitMetricsIntoBatches;
    /**
     * Create a single GA4Query object with proper metadata for result mapping.
     */
    private createQuery;
    /**
     * Create a query plan for the standard GA4 summary query.
     * This is the most common case: fetching multiple metrics without dimensions.
     */
    planSummary(metrics: string[]): GA4QueryPlan;
    /**
     * Create a query plan for a dimensional query.
     * Handles metrics + dimensions without splitting dimensions.
     */
    planDimensional(metrics: string[], dimensions: string[], limit?: number, orderBys?: Array<{
        metric?: {
            metricName: string;
        };
        dimension?: {
            dimensionName: string;
        };
        desc?: boolean;
    }>): GA4QueryPlan;
    /**
     * Get information about current limits.
     * Useful for logging and debugging.
     */
    getLimits(): GA4QueryLimits;
    /**
     * Check if a query configuration would exceed limits.
     * Returns validation errors if any.
     */
    validate(metrics: string[], dimensions: string[]): string[];
}
export declare const ga4QueryPlanner: QueryPlanner;
export {};
//# sourceMappingURL=ga4-query-planner.d.ts.map