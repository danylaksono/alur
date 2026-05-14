import type { VisualFilter } from '../types/visualAnalytics';

export const quoteIdentifier = (name: string) => `"${name.replace(/"/g, '""')}"`;

const quoteLiteral = (value: string) => `'${value.replace(/'/g, "''")}'`;

export const compileVisualFilterPredicate = (filter: VisualFilter): string | null => {
  const field = quoteIdentifier(filter.field);

  if (filter.kind === 'category') {
    const valuePredicates = filter.values.map((value) => `CAST(${field} AS VARCHAR) = ${quoteLiteral(value)}`);
    const predicates = [...valuePredicates];
    if (filter.includeNull) predicates.push(`${field} IS NULL`);
    if (!predicates.length) return null;
    return `(${predicates.join(' OR ')})`;
  }

  if (filter.kind === 'temporal') {
    const predicates: string[] = [];
    if (filter.start) predicates.push(`TRY_CAST(${field} AS TIMESTAMP) >= TRY_CAST(${quoteLiteral(filter.start)} AS TIMESTAMP)`);
    if (filter.end) predicates.push(`TRY_CAST(${field} AS TIMESTAMP) <= TRY_CAST(${quoteLiteral(filter.end)} AS TIMESTAMP)`);
    if (!predicates.length && !filter.includeNull) return null;
    const temporalPredicate = predicates.length ? `(${predicates.join(' AND ')})` : '';
    if (filter.includeNull) {
      return temporalPredicate ? `(${temporalPredicate} OR ${field} IS NULL)` : `${field} IS NULL`;
    }
    return temporalPredicate;
  }

  const predicates: string[] = [];
  if (filter.min !== undefined) predicates.push(`CAST(${field} AS DOUBLE) >= ${filter.min}`);
  if (filter.max !== undefined) predicates.push(`CAST(${field} AS DOUBLE) <= ${filter.max}`);
  if (!predicates.length && !filter.includeNull) return null;
  const rangePredicate = predicates.length ? `(${predicates.join(' AND ')})` : '';
  if (filter.includeNull) {
    return rangePredicate ? `(${rangePredicate} OR ${field} IS NULL)` : `${field} IS NULL`;
  }
  return rangePredicate;
};

export const compileVisualFiltersWhereClause = (filters: VisualFilter[]) => {
  const predicates = filters.map(compileVisualFilterPredicate).filter((item): item is string => Boolean(item));
  return predicates.length ? `WHERE ${predicates.join(' AND ')}` : '';
};
