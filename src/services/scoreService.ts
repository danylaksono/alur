import { duckdbService } from './duckdb';
import type { DatasetDescriptor } from '../types/datasets';
import type { ScoreModelSpec } from '../types/visualAnalytics';
import {
  buildContributionSelects,
  buildScoreExpression,
  perturbedScoreModel,
  scoreModelErrors,
} from '../utils/scoreModel';
import { quoteIdentifier } from '../utils/visualFilterSql';

/**
 * Runs a score model against a dataset so weights can be edited and re-ranked
 * live, without going through the workflow.
 *
 * The workflow node and this service share one compiler, so what the panel
 * previews is what the pipeline will produce. Everything here is bounded: a
 * preview reads the top N rows, never the whole table.
 */

const normaliseRows = (rows: any[]) => rows.map((row) => (typeof row?.toJSON === 'function' ? row.toJSON() : row));
const finite = (value: unknown) => {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

export type ScoredRow = {
  key: string;
  rank: number;
  score: number | null;
  /** Weighted contribution per criterion field. Sums to `score`. */
  contributions: Record<string, number | null>;
};

export type ScorePreview = {
  rows: ScoredRow[];
  totalRows: number;
  /** Rows that scored. Lower than `totalRows` when the missing-value policy excludes some. */
  scoredRows: number;
  labelField: string | null;
  warnings: string[];
};

const relationFor = (dataset: DatasetDescriptor) => dataset.relationName || (dataset.source.kind === 'table' ? dataset.source.tableName : null);

const labelCache = new Map<string, string | null>();

/** Below this many distinct values a column is a category rather than a label. */
const MINIMUM_LABEL_CARDINALITY = 20;

/**
 * Picks the column that best tells one ranked row from another.
 *
 * Naming alone is a bad guide: a column called `REGION` reads like a label but
 * can hold the same value for every row, which turns the ranked list into the
 * same string repeated. So candidates are probed for how many distinct values
 * they actually carry, and a column that cannot distinguish anything loses to
 * the row id. Probed once per dataset version, then cached.
 */
const chooseLabelField = async (dataset: DatasetDescriptor, exclude: Set<string>, relation: string) => {
  const cacheKey = `${dataset.id}:${dataset.sourceUpdatedAt}:${[...exclude].sort().join(',')}`;
  const cached = labelCache.get(cacheKey);
  if (cached !== undefined) return cached;

  const candidates = dataset.fields
    .filter((field) => !exclude.has(field.name) && !field.name.startsWith('__alur') && /VARCHAR|TEXT|STRING/i.test(field.type))
    .sort((a, b) => Number(/name|label|title|ward|area|code/i.test(b.name)) - Number(/name|label|title|ward|area|code/i.test(a.name)))
    .slice(0, 8);

  let chosen: string | null = dataset.rowIdColumn || null;
  if (candidates.length) {
    const probe = candidates.map((field, index) => `APPROX_COUNT_DISTINCT(${quoteIdentifier(field.name)}) AS d${index}`).join(', ');
    try {
      const result = await duckdbService.query(`SELECT ${probe} FROM ${relation};`);
      const row = normaliseRows(result.toArray())[0] || {};
      const ranked = candidates
        .map((field, index) => ({ name: field.name, distinct: Number(row[`d${index}`] ?? 0) }))
        .sort((a, b) => b.distinct - a.distinct);
      // A column with a handful of values is a category, not a label: showing
      // it would print the same string down the whole ranked list. The row id
      // at least tells the rows apart.
      if (ranked[0] && ranked[0].distinct >= MINIMUM_LABEL_CARDINALITY) chosen = ranked[0].name;
    } catch {
      chosen = candidates[0].name;
    }
  }

  labelCache.set(cacheKey, chosen);
  return chosen;
};

export const clearScoreLabelCache = () => labelCache.clear();

export const queryScorePreview = async ({
  dataset,
  spec,
  resultField = 'alur_score',
  limit = 25,
  whereClause = '',
}: {
  dataset: DatasetDescriptor;
  spec: ScoreModelSpec;
  resultField?: string;
  limit?: number;
  whereClause?: string;
}): Promise<ScorePreview> => {
  const errors = scoreModelErrors(spec);
  const relation = relationFor(dataset);
  if (errors.length || !relation) {
    return { rows: [], totalRows: 0, scoredRows: 0, labelField: null, warnings: errors.length ? errors : ['This dataset cannot be queried directly.'] };
  }

  const quotedRelation = quoteIdentifier(relation);
  const contributions = buildContributionSelects(spec, resultField, { relation: quotedRelation });
  const criterionFields = new Set(spec.criteria.map((criterion) => criterion.field));
  const labelField = await chooseLabelField(dataset, criterionFields, quotedRelation);
  const where = whereClause ? ` WHERE ${whereClause}` : '';

  const scoreSelects = [
    `${buildScoreExpression(spec, { relation: quotedRelation })} AS __alur_score`,
    ...contributions.map((item, index) => `${item.expression} AS __alur_c${index}`),
    labelField ? `CAST(${quoteIdentifier(labelField)} AS VARCHAR) AS __alur_label` : `CAST(ROW_NUMBER() OVER () AS VARCHAR) AS __alur_label`,
  ];

  const sql = `
    WITH scored AS (
      SELECT ${scoreSelects.join(', ')}
      FROM ${quotedRelation}${where}
    ),
    ranked AS (
      SELECT *, RANK() OVER (ORDER BY __alur_score DESC NULLS LAST) AS __alur_rank
      FROM scored
    )
    SELECT *,
      (SELECT COUNT(*) FROM scored) AS __alur_total,
      (SELECT COUNT(__alur_score) FROM scored) AS __alur_scored
    FROM ranked
    ORDER BY __alur_rank
    LIMIT ${Math.max(1, Math.floor(limit))};
  `;

  const result = await duckdbService.query(sql);
  const rows = normaliseRows(result.toArray());

  return {
    rows: rows.map((row) => ({
      key: String(row.__alur_label ?? ''),
      rank: Number(row.__alur_rank ?? 0),
      score: finite(row.__alur_score),
      contributions: Object.fromEntries(contributions.map((item, index) => [item.field, finite(row[`__alur_c${index}`])])),
    })),
    totalRows: Number(rows[0]?.__alur_total ?? 0),
    scoredRows: Number(rows[0]?.__alur_scored ?? 0),
    labelField,
    warnings: [],
  };
};

export type CriterionSensitivity = {
  field: string;
  /** Spearman correlation between the base and nudged rankings. 1 means nothing moved. */
  rankCorrelation: number | null;
  /** How many of the base top-N drop out when this weight is nudged. */
  topNChanged: number;
  /** Mean absolute rank shift across every scored row. */
  meanRankShift: number | null;
};

export type ScoreSensitivity = {
  criteria: CriterionSensitivity[];
  delta: number;
  topN: number;
  warnings: string[];
};

/**
 * Asks how much the ranking rests on each weight.
 *
 * Nudges one weight at a time and reports how far the ranking moved. A
 * criterion whose ±nudge barely disturbs the top of the list is one the user
 * need not agonise over; one that reshuffles it is where the argument actually
 * is. All criteria are compared in a single query, so this stays one round
 * trip regardless of how many there are.
 */
export const queryScoreSensitivity = async ({
  dataset,
  spec,
  delta = 0.25,
  topN = 20,
  whereClause = '',
}: {
  dataset: DatasetDescriptor;
  spec: ScoreModelSpec;
  delta?: number;
  topN?: number;
  whereClause?: string;
}): Promise<ScoreSensitivity> => {
  const errors = scoreModelErrors(spec);
  const relation = relationFor(dataset);
  const active = spec.criteria.filter((criterion) => criterion.field && criterion.weight !== 0);
  if (errors.length || !relation || active.length < 2) {
    return {
      criteria: [],
      delta,
      topN,
      warnings: errors.length ? errors : active.length < 2 ? ['Sensitivity needs at least two weighted criteria.'] : ['This dataset cannot be queried directly.'],
    };
  }

  const where = whereClause ? ` WHERE ${whereClause}` : '';
  const quotedRelation = quoteIdentifier(relation);
  const scoreOptions = { relation: quotedRelation };
  const scoreSelects = [
    `${buildScoreExpression(spec, scoreOptions)} AS s0`,
    ...active.map((criterion, index) => `${buildScoreExpression(perturbedScoreModel(spec, criterion.field, delta), scoreOptions)} AS s${index + 1}`),
  ];
  const rankSelects = [
    'RANK() OVER (ORDER BY s0 DESC NULLS LAST) AS r0',
    ...active.map((_, index) => `RANK() OVER (ORDER BY s${index + 1} DESC NULLS LAST) AS r${index + 1}`),
  ];
  const comparisons = active.flatMap((_, index) => [
    `CORR(r0, r${index + 1}) AS corr${index}`,
    `COUNT(*) FILTER (WHERE r0 <= ${topN} AND r${index + 1} > ${topN}) AS churn${index}`,
    `AVG(ABS(r0 - r${index + 1})) AS shift${index}`,
  ]);

  const sql = `
    WITH scored AS (
      SELECT ${scoreSelects.join(', ')}
      FROM ${quotedRelation}${where}
    ),
    ranked AS (
      SELECT ${rankSelects.join(', ')}
      FROM scored
    )
    SELECT ${comparisons.join(', ')} FROM ranked;
  `;

  const result = await duckdbService.query(sql);
  const row = normaliseRows(result.toArray())[0] || {};

  return {
    criteria: active.map((criterion, index) => ({
      field: criterion.field,
      rankCorrelation: finite(row[`corr${index}`]),
      topNChanged: Number(row[`churn${index}`] ?? 0),
      meanRankShift: finite(row[`shift${index}`]),
    })),
    delta,
    topN,
    warnings: [],
  };
};
