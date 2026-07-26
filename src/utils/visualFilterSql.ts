import type { VisualFilter } from '../types/visualAnalytics';

export const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;

const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

const applyMode = (predicate: string | null, filter: VisualFilter) => {
  if (!predicate) return null;
  return 'mode' in filter && filter.mode === 'exclude'
    ? `(NOT COALESCE(${predicate}, FALSE))`
    : predicate;
};

export const compileVisualFilterPredicate = (filter: VisualFilter): string | null => {
  const field = quoteIdentifier(filter.field);

  if (filter.kind === 'category') {
    const valuePredicates = filter.values.map((value) => `CAST(${field} AS VARCHAR) = ${quoteLiteral(value)}`);
    const predicates = [...valuePredicates];
    if (filter.includeNull) predicates.push(`${field} IS NULL`);
    if (!predicates.length) return null;
    return applyMode(`(${predicates.join(' OR ')})`, filter);
  }

  if (filter.kind === 'temporal') {
    const predicates: string[] = [];
    if (filter.start) predicates.push(`TRY_CAST(${field} AS TIMESTAMP) >= TRY_CAST(${quoteLiteral(filter.start)} AS TIMESTAMP)`);
    if (filter.end) predicates.push(`TRY_CAST(${field} AS TIMESTAMP) <= TRY_CAST(${quoteLiteral(filter.end)} AS TIMESTAMP)`);
    if (!predicates.length && !filter.includeNull) return null;
    const temporalPredicate = predicates.length ? `(${predicates.join(' AND ')})` : '';
    if (filter.includeNull) {
      return applyMode(temporalPredicate ? `(${temporalPredicate} OR ${field} IS NULL)` : `${field} IS NULL`, filter);
    }
    return applyMode(temporalPredicate, filter);
  }

  if (filter.kind === 'text') {
    const rawField = `CAST(${field} AS VARCHAR)`;
    const comparableField = filter.caseSensitive ? rawField : `lower(${rawField})`;
    const value = filter.caseSensitive ? filter.value : filter.value.toLocaleLowerCase();
    const literal = quoteLiteral(value);
    const predicate = filter.operator === 'contains'
      ? `contains(${comparableField}, ${literal})`
      : filter.operator === 'starts_with'
        ? `starts_with(${comparableField}, ${literal})`
        : filter.operator === 'ends_with'
          ? `ends_with(${comparableField}, ${literal})`
          : `${comparableField} = ${literal}`;
    return applyMode(predicate, filter);
  }

  if (filter.kind === 'boolean') {
    return applyMode(`TRY_CAST(${field} AS BOOLEAN) IS ${filter.value ? 'TRUE' : 'FALSE'}`, filter);
  }

  if (filter.kind === 'null') return `${field} IS ${filter.isNull ? '' : 'NOT '}NULL`;

  const predicates: string[] = [];
  if (filter.min !== undefined && Number.isFinite(filter.min)) predicates.push(`CAST(${field} AS DOUBLE) >= ${filter.min}`);
  if (filter.max !== undefined && Number.isFinite(filter.max)) predicates.push(`CAST(${field} AS DOUBLE) <= ${filter.max}`);
  if (!predicates.length && !filter.includeNull) return null;
  const rangePredicate = predicates.length ? `(${predicates.join(' AND ')})` : '';
  if (filter.includeNull) {
    return applyMode(rangePredicate ? `(${rangePredicate} OR ${field} IS NULL)` : `${field} IS NULL`, filter);
  }
  return applyMode(rangePredicate, filter);
};

export const compileVisualFiltersWhereClause = (filters: VisualFilter[]) => {
  const predicates = filters.map(compileVisualFilterPredicate).filter((item): item is string => Boolean(item));
  return predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
};
