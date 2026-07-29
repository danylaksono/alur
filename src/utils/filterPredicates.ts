import { quoteIdentifier } from './visualFilterSql';

/**
 * Compiles a list of named conditions into SQL that can either remove rows or
 * explain why they would have been removed.
 *
 * A `WHERE` clause answers "what survived". It cannot answer "why isn't this
 * row in my result", which is the question analysts actually ask, because the
 * evidence is destroyed by the same statement that produces the answer. So the
 * conditions are named, evaluated individually, and the failures recorded on
 * the row rather than being implied by its absence.
 *
 * Like the score compiler, this is a pure string builder: the same predicates
 * have to compile into a workflow node and into a standalone funnel query.
 */

export type PredicateSeverity = 'hard' | 'soft';

export type FilterPredicate = {
  id: string;
  /** Human name for the condition. Falls back to the expression itself. */
  label?: string;
  expression: string;
  /** `hard` can remove a row; `soft` only ever annotates it. */
  severity: PredicateSeverity;
};

/** `drop` removes rows failing a hard condition; `tag` keeps everything and only records. */
export type FilterOutcome = 'drop' | 'tag';

export const DEFAULT_EXCLUSION_FIELD = 'alur_excluded';

/** The three columns a tagging filter writes. */
export const exclusionColumns = (field: string = DEFAULT_EXCLUSION_FIELD) => ({
  /** Boolean: would a hard condition have removed this row. */
  excluded: field,
  /** Text: the names of every failing condition, hard and soft. */
  reasons: `${field}_by`,
  /** Integer: how many conditions this row fails. */
  count: `${field}_count`,
});

const REASONS_INTERMEDIATE = '__alur_exclusion_reasons';

const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

export const activeFilterPredicates = (predicates: FilterPredicate[] | undefined): FilterPredicate[] =>
  (Array.isArray(predicates) ? predicates : []).filter(
    (predicate) => predicate && typeof predicate.expression === 'string' && predicate.expression.trim().length > 0,
  );

export const predicateLabel = (predicate: FilterPredicate, index: number) =>
  predicate.label?.trim() || predicate.expression.trim() || `Condition ${index + 1}`;

const isHard = (predicate: FilterPredicate) => predicate.severity !== 'soft';

/**
 * Whether a row satisfies one condition, in a form that is never NULL.
 *
 * `WHERE x > 5` keeps only rows where the comparison is TRUE — a NULL `x`
 * makes the comparison NULL and the row is dropped. But the obvious tagging
 * expression `NOT (x > 5)` is *also* NULL for that row, so it would record no
 * reason: the row would vanish with its explanation blank, which is precisely
 * the failure this whole mode exists to prevent. Coalescing to FALSE first
 * makes the recorded reason agree with the filter for every row.
 */
export const predicatePassesExpression = (predicate: FilterPredicate) =>
  `COALESCE((${predicate.expression}), FALSE)`;

/** The conjunction of every hard condition, or `null` when nothing can remove a row. */
export const buildKeepExpression = (predicates: FilterPredicate[]): string | null => {
  const hard = activeFilterPredicates(predicates).filter(isHard);
  return hard.length ? hard.map(predicatePassesExpression).join(' AND ') : null;
};

export const filterPredicateErrors = (predicates: FilterPredicate[] | undefined): string[] => {
  const errors: string[] = [];
  const active = activeFilterPredicates(predicates);
  if (!active.length) {
    errors.push('Add at least one condition.');
    return errors;
  }
  const labels = active.map(predicateLabel);
  const duplicate = labels.find((label, index) => labels.indexOf(label) !== index);
  // Two conditions sharing a name would produce an exclusion reason that names
  // neither of them unambiguously, which defeats the point.
  if (duplicate) errors.push(`Two conditions are both called "${duplicate}". Name them apart so exclusions stay readable.`);
  return errors;
};

export type ExclusionSelects = {
  columns: ReturnType<typeof exclusionColumns>;
  /** Computed against the source rows. */
  inner: string[];
  /** Computed from the inner projection, which is where the reason list lives. */
  outer: string[];
  /** Intermediate column the outer selects consume and the projection drops. */
  intermediate: string;
};

/**
 * The columns that record why each row is where it is.
 *
 * Two passes rather than one, so the reason list is built once and both the
 * readable text and the count are derived from it instead of recomputing every
 * predicate three times.
 */
export const buildExclusionSelects = (
  predicates: FilterPredicate[],
  field: string = DEFAULT_EXCLUSION_FIELD,
): ExclusionSelects | null => {
  const active = activeFilterPredicates(predicates);
  if (!active.length) return null;
  const columns = exclusionColumns(field);

  const reasonEntries = active.map(
    (predicate, index) => `CASE WHEN NOT ${predicatePassesExpression(predicate)} THEN ${quoteLiteral(predicateLabel(predicate, index))} END`,
  );
  const keep = buildKeepExpression(active);

  return {
    columns,
    intermediate: REASONS_INTERMEDIATE,
    inner: [
      // Never NULL, because every operand is already coalesced.
      `${keep ? `NOT (${keep})` : 'FALSE'} AS ${quoteIdentifier(columns.excluded)}`,
      `list_filter([${reasonEntries.join(', ')}], x -> x IS NOT NULL) AS ${quoteIdentifier(REASONS_INTERMEDIATE)}`,
    ],
    outer: [
      // NULL rather than an empty string for rows nothing excluded: no reason
      // is a genuine absence, and the boolean column is what map styling greys
      // on anyway.
      `NULLIF(array_to_string(${quoteIdentifier(REASONS_INTERMEDIATE)}, ' · '), '') AS ${quoteIdentifier(columns.reasons)}`,
      `len(${quoteIdentifier(REASONS_INTERMEDIATE)}) AS ${quoteIdentifier(columns.count)}`,
    ],
  };
};

export type FunnelStepPlan = {
  id: string;
  label: string;
  severity: PredicateSeverity;
  soloKey: string;
  /** Absent for soft conditions, which never remove anything. */
  cumulativeKey: string | null;
};

/**
 * One query that measures every condition, both on its own and in sequence.
 *
 * The two numbers answer different questions and the gap between them is the
 * interesting part: a condition that removes 5,000 rows alone but only 12 more
 * once the earlier conditions have run is doing almost no work, and the user
 * is arguing about a constraint that does not bind.
 */
export const buildFunnelQuery = (predicates: FilterPredicate[]) => {
  const active = activeFilterPredicates(predicates);
  const selects = ['COUNT(*) AS total'];
  const steps: FunnelStepPlan[] = [];
  const precedingHard: string[] = [];

  active.forEach((predicate, index) => {
    const passes = predicatePassesExpression(predicate);
    const soloKey = `solo${index}`;
    selects.push(`COUNT(*) FILTER (WHERE ${passes}) AS ${soloKey}`);

    let cumulativeKey: string | null = null;
    if (isHard(predicate)) {
      precedingHard.push(passes);
      cumulativeKey = `cum${index}`;
      selects.push(`COUNT(*) FILTER (WHERE ${precedingHard.join(' AND ')}) AS ${cumulativeKey}`);
    }
    steps.push({ id: predicate.id, label: predicateLabel(predicate, index), severity: predicate.severity, soloKey, cumulativeKey });
  });

  return { selects, steps };
};

export type FunnelStep = {
  id: string;
  label: string;
  severity: PredicateSeverity;
  /** Rows this condition removes on its own, ignoring every other condition. */
  removedAlone: number;
  /** Rows left after this condition and every hard one before it. `null` for soft. */
  remaining: number | null;
  /** Rows removed here that no earlier hard condition had already removed. `null` for soft. */
  removedHere: number | null;
};

export type ConstraintFunnel = {
  total: number;
  kept: number;
  steps: FunnelStep[];
  warnings: string[];
};
