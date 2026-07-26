import type { CohortComparisonSelection, CohortSpec, VisualFilter } from '../types/visualAnalytics';

const nullExpression = (field: string): unknown[] => [
  'any',
  ['!', ['has', field]],
  ['==', ['get', field], null],
];

const withOptionalNull = (expression: unknown[] | undefined, field: string, includeNull?: boolean) => {
  if (!includeNull) return expression;
  return expression ? ['any', expression, ...nullExpression(field).slice(1)] : nullExpression(field);
};

export const compileMapFilter = (filters: VisualFilter[]) => {
  const expressions = filters.map((filter) => {
    let expression: unknown[] | undefined;

    if (filter.kind === 'category') {
      expression = withOptionalNull(
        ['in', ['to-string', ['get', filter.field]], ['literal', filter.values]],
        filter.field,
        filter.includeNull,
      );
    } else if (filter.kind === 'temporal') {
      const predicates: unknown[] = [];
      if (filter.start) predicates.push(['>=', ['to-string', ['get', filter.field]], filter.start]);
      if (filter.end) predicates.push(['<=', ['to-string', ['get', filter.field]], filter.end]);
      expression = withOptionalNull(
        (predicates.length > 1 ? ['all', ...predicates] : predicates[0]) as unknown[] | undefined,
        filter.field,
        filter.includeNull,
      );
    } else if (filter.kind === 'range') {
      const predicates: unknown[] = [];
      if (filter.min !== undefined) predicates.push(['>=', ['to-number', ['get', filter.field]], filter.min]);
      if (filter.max !== undefined) predicates.push(['<=', ['to-number', ['get', filter.field]], filter.max]);
      expression = withOptionalNull(
        (predicates.length > 1 ? ['all', ...predicates] : predicates[0]) as unknown[] | undefined,
        filter.field,
        filter.includeNull,
      );
    } else if (filter.kind === 'text') {
      const rawField: unknown[] = ['to-string', ['get', filter.field]];
      const comparableField: unknown[] = filter.caseSensitive ? rawField : ['downcase', rawField];
      const value = filter.caseSensitive ? filter.value : filter.value.toLocaleLowerCase();
      const comparison = filter.operator === 'contains'
        ? ['>=', ['index-of', value, comparableField], 0]
        : filter.operator === 'starts_with'
          ? ['==', ['slice', comparableField, 0, value.length], value]
          : filter.operator === 'ends_with'
            ? ['==', ['slice', comparableField, ['-', ['length', comparableField], value.length]], value]
            : ['==', comparableField, value];
      expression = ['all', ['has', filter.field], comparison];
    } else if (filter.kind === 'boolean') {
      expression = ['all', ['has', filter.field], ['==', ['to-boolean', ['get', filter.field]], filter.value]];
    } else {
      const isNull = nullExpression(filter.field);
      expression = filter.isNull ? isNull : ['!', isNull];
    }

    if (!expression) return undefined;
    return 'mode' in filter && filter.mode === 'exclude' ? ['!', expression] : expression;
  }).filter((expression): expression is unknown[] => Boolean(expression));

  if (!expressions.length) return null;
  return expressions.length === 1 ? expressions[0] : ['all', ...expressions];
};

export const applyCohortComparisonPaint = (
  paint: Record<string, unknown>,
  cohorts: CohortSpec[],
  comparison: CohortComparisonSelection | undefined,
  remainderFilters: VisualFilter[] = [],
) => {
  if (!comparison) return paint;
  const cohortA = cohorts.find((cohort) => cohort.id === comparison.cohortAId && cohort.definition.kind === 'filters');
  const cohortB = cohorts.find((cohort) => cohort.id === comparison.cohortBId && cohort.definition.kind === 'filters');
  if (!cohortA || (!cohortB && !comparison.compareToRemainder)) return paint;
  const expressionA = compileMapFilter(cohortA.definition.kind === 'filters' ? cohortA.definition.filters : [] ) || true;
  const expressionB = comparison.compareToRemainder
    ? ['all', compileMapFilter(remainderFilters) || true, ['!', expressionA]]
    : compileMapFilter(cohortB!.definition.kind === 'filters' ? cohortB!.definition.filters : []) || true;
  const colourKeys = ['circle-color', 'line-color', 'fill-color', 'fill-extrusion-color'];
  const opacityKeys = ['circle-opacity', 'line-opacity', 'fill-opacity', 'fill-extrusion-opacity'];
  const next = { ...paint };
  colourKeys.forEach((key) => {
    if (!(key in paint)) return;
    next[key] = ['case', ['all', expressionA, expressionB], '#7c3aed', expressionA, cohortA.colour, expressionB, cohortB?.colour || '#f97316', '#cbd5e1'];
  });
  opacityKeys.forEach((key) => {
    if (!(key in paint)) return;
    const base = paint[key];
    next[key] = ['case', ['any', expressionA, expressionB], base, 0.18];
  });
  return next;
};
