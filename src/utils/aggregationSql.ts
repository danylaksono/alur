import { quoteIdentifier } from './visualFilterSql';

/**
 * SQL builders for the two aggregation nodes.
 *
 * Both are pure string builders with no store or engine access, so the same
 * expressions can be used by the workflow compiler, by a node's SQL preview,
 * and by anything that later wants to run one ad hoc.
 */

// ─── summary aggregation ──────────────────────────────────────────────

export type SummaryFunction = 'count' | 'count_distinct' | 'sum' | 'avg' | 'min' | 'max' | 'median';

export type SummaryMeasure = {
  id: string;
  fn: SummaryFunction;
  /** Required by every function except `count`, which counts rows. */
  field?: string;
  /** Output column name. Derived from the function and field when absent. */
  alias?: string;
};

export const SUMMARY_FUNCTIONS: Array<{ value: SummaryFunction; label: string; needsField: boolean }> = [
  { value: 'count', label: 'Count of rows', needsField: false },
  { value: 'count_distinct', label: 'Count distinct', needsField: true },
  { value: 'sum', label: 'Sum', needsField: true },
  { value: 'avg', label: 'Average', needsField: true },
  { value: 'median', label: 'Median', needsField: true },
  { value: 'min', label: 'Minimum', needsField: true },
  { value: 'max', label: 'Maximum', needsField: true },
];

const NEEDS_FIELD = new Set(SUMMARY_FUNCTIONS.filter((item) => item.needsField).map((item) => item.value));

/** Only the arithmetic functions cast. `min`/`max` stay raw so they still work on dates and text. */
const CASTS_TO_NUMBER = new Set<SummaryFunction>(['sum', 'avg', 'median']);

const sanitise = (name: string) => name.replace(/[^a-zA-Z0-9_]/g, '_').replace(/^(\d)/, '_$1');

export const measureAlias = (measure: SummaryMeasure) => {
  if (measure.alias?.trim()) return measure.alias.trim();
  if (measure.fn === 'count') return 'row_count';
  return sanitise(`${measure.fn}_${measure.field || 'value'}`);
};

/** `null` when the measure is incomplete, so a half-configured node reports rather than emits broken SQL. */
export const buildMeasureSelect = (measure: SummaryMeasure): string | null => {
  if (measure.fn === 'count') return `COUNT(*) AS ${quoteIdentifier(measureAlias(measure))}`;
  if (!measure.field) return null;

  const column = quoteIdentifier(measure.field);
  const value = CASTS_TO_NUMBER.has(measure.fn) ? `TRY_CAST(${column} AS DOUBLE)` : column;
  const call = measure.fn === 'count_distinct' ? `COUNT(DISTINCT ${column})` : `${measure.fn.toUpperCase()}(${value})`;
  return `${call} AS ${quoteIdentifier(measureAlias(measure))}`;
};

export const summaryMeasureErrors = (measures: SummaryMeasure[]) => {
  const errors: string[] = [];
  if (!measures.length) errors.push('Add at least one measure.');
  measures.forEach((measure) => {
    if (NEEDS_FIELD.has(measure.fn) && !measure.field) errors.push(`${measure.fn} needs a column.`);
  });
  const aliases = measures.map(measureAlias);
  const duplicate = aliases.find((alias, index) => aliases.indexOf(alias) !== index);
  if (duplicate) errors.push(`Two measures both produce "${duplicate}". Rename one.`);
  return errors;
};

// ─── running-total allocation ─────────────────────────────────────────

export type AllocationMode = 'flag' | 'cut' | 'scale';

export type AllocationConfig = {
  /** Column deciding who gets served first — a score, a rank, a need measure. */
  orderBy: string;
  direction?: 'desc' | 'asc';
  /** Column being consumed: cost, capacity, load. */
  amountField: string;
  /** How much there is to go round. */
  limit: number;
  /** Optional: one budget per group rather than one overall. */
  partitionBy?: string;
  mode?: AllocationMode;
};

export type AllocationColumns = {
  cumulative: string;
  status: string;
  allocated: string;
};

export const allocationColumns = (config: AllocationConfig): AllocationColumns => ({
  cumulative: sanitise(`cumulative_${config.amountField}`),
  status: sanitise(`${config.amountField}_status`),
  allocated: sanitise(`allocated_${config.amountField}`),
});

export const allocationErrors = (config: Partial<AllocationConfig>) => {
  const errors: string[] = [];
  if (!config.orderBy) errors.push('Choose the column that decides priority order.');
  if (!config.amountField) errors.push('Choose the column being consumed.');
  if (!Number.isFinite(config.limit)) errors.push('Set a numeric limit.');
  else if ((config.limit as number) <= 0) errors.push('The limit must be greater than zero.');
  return errors;
};

/**
 * Selects the running total, a within/over flag, and — in `scale` mode — the
 * amount that actually fits.
 *
 * `scale` exists because a hard cut-off silently discards the row straddling
 * the limit, which in an allocation is usually the most interesting one: it
 * gets a partial share rather than nothing.
 */
export const buildAllocationSelects = (config: AllocationConfig) => {
  const columns = allocationColumns(config);
  const amount = `COALESCE(TRY_CAST(${quoteIdentifier(config.amountField)} AS DOUBLE), 0)`;
  const partition = config.partitionBy ? `PARTITION BY ${quoteIdentifier(config.partitionBy)} ` : '';
  const window = `OVER (${partition}ORDER BY ${quoteIdentifier(config.orderBy)} ${config.direction === 'asc' ? 'ASC' : 'DESC'} ROWS UNBOUNDED PRECEDING)`;
  const cumulative = `SUM(${amount}) ${window}`;

  const selects = [
    `${cumulative} AS ${quoteIdentifier(columns.cumulative)}`,
    `CASE WHEN ${cumulative} <= ${config.limit} THEN 'within' ELSE 'over' END AS ${quoteIdentifier(columns.status)}`,
  ];

  if (config.mode === 'scale') {
    // Budget left before this row is the running total minus its own amount.
    const remaining = `(${config.limit} - (${cumulative} - ${amount}))`;
    selects.push(`LEAST(${amount}, GREATEST(0, ${remaining})) AS ${quoteIdentifier(columns.allocated)}`);
  }

  return { columns, selects };
};

// ─── top-N selection ──────────────────────────────────────────────────

/**
 * `QUALIFY` filters on a window function without needing a subquery, so "the
 * top 50 by score" stays one readable statement. `RANK` rather than
 * `ROW_NUMBER` so ties are kept together — dropping one of two identically
 * scored candidates on row order alone is not a decision anyone made.
 */
export const buildTopNQualify = (field: string, count: number, direction: 'desc' | 'asc' = 'desc') =>
  `RANK() OVER (ORDER BY ${quoteIdentifier(field)} ${direction === 'asc' ? 'ASC' : 'DESC'}) <= ${Math.max(1, Math.floor(count))}`;
