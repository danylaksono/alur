import { describe, expect, it } from 'vitest';
import { resolveTableSearch, searchPredicateFor, tableSearchPredicate } from './tableSearch';

const COLUMNS = ['UPRN', 'Post Code', 'Single Line Address', 'buildingid'];

describe('resolveTableSearch', () => {
  it('leaves a plain term unscoped', () => {
    expect(resolveTableSearch('10012775204', COLUMNS)).toEqual({ term: '10012775204', field: null });
  });

  it('scopes on a field=value prefix, case-insensitively', () => {
    expect(resolveTableSearch('uprn=10012775204', COLUMNS)).toEqual({ term: '10012775204', field: 'UPRN' });
  });

  it('scopes on a field: value prefix, including names with spaces', () => {
    expect(resolveTableSearch('Post Code: SW1A 2AA', COLUMNS)).toEqual({ term: 'SW1A 2AA', field: 'Post Code' });
  });

  it('treats a prefix that is not a column as ordinary text', () => {
    expect(resolveTableSearch('height: tall', COLUMNS)).toEqual({ term: 'height: tall', field: null });
  });

  it('lets an explicit field choice win over the typed prefix', () => {
    expect(resolveTableSearch('uprn=123', COLUMNS, 'Post Code')).toEqual({ term: 'uprn=123', field: 'Post Code' });
  });

  it('ignores a chosen field the source does not have', () => {
    expect(resolveTableSearch('abc', COLUMNS, 'dropped_column')).toEqual({ term: 'abc', field: null });
  });
});

describe('tableSearchPredicate', () => {
  it('is empty without a term', () => {
    expect(tableSearchPredicate({ term: '   ', field: 'UPRN' }, COLUMNS)).toBe('');
  });

  it('touches one column when scoped', () => {
    expect(tableSearchPredicate({ term: '10012775204', field: 'UPRN' }, COLUMNS))
      .toBe(`(CAST("UPRN" AS VARCHAR) ILIKE '%10012775204%')`);
  });

  it('ORs every column when unscoped', () => {
    const predicate = tableSearchPredicate({ term: 'abc', field: null }, COLUMNS);
    expect(predicate.split(' OR ')).toHaveLength(COLUMNS.length);
  });

  it('escapes quotes in the term and the column name', () => {
    expect(tableSearchPredicate({ term: "O'Brien", field: 'we"ird' }, ['we"ird']))
      .toBe(`(CAST("we""ird" AS VARCHAR) ILIKE '%O''Brien%')`);
  });
});

describe('searchPredicateFor', () => {
  it('scopes a typed prefix down to a single column', () => {
    expect(searchPredicateFor('UPRN=10012775204', COLUMNS))
      .toBe(`(CAST("UPRN" AS VARCHAR) ILIKE '%10012775204%')`);
  });
});
