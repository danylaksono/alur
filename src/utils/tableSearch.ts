import { quoteIdentifier } from './visualFilterSql';

type TableSearch = {
  /** The text to match. */
  term: string;
  /** The single column to match against, or null to match every column. */
  field: string | null;
};

const SCOPE_PATTERN = /^([^:=]+?)\s*[:=]\s*(.*)$/;

const matchColumn = (columns: string[], name: string) => {
  const wanted = name.trim().toLowerCase();
  return columns.find((column) => column.toLowerCase() === wanted) || null;
};

/**
 * Works out which column a search runs against. An explicit field choice wins;
 * otherwise a `UPRN=10012775204` or `Post Code: SW1` prefix scopes the search
 * when the prefix names a real column. Scoping matters for more than
 * convenience: an unscoped search casts and matches every column of every row,
 * which on a wide table (the standardised buildings extract has 181 columns and
 * 946k rows) is ~171M string comparisons on the single DuckDB connection the
 * map tiles also queue behind.
 */
export const resolveTableSearch = (
  raw: string,
  columns: string[],
  field?: string | null,
): TableSearch => {
  const term = raw.trim();
  const chosen = field ? matchColumn(columns, field) : null;
  if (chosen) return { term, field: chosen };
  if (!term) return { term: '', field: null };
  const scoped = SCOPE_PATTERN.exec(term);
  if (scoped) {
    const column = matchColumn(columns, scoped[1]);
    if (column) return { term: scoped[2].trim(), field: column };
  }
  return { term, field: null };
};

/** Compiles a resolved search into a boolean SQL expression, or '' for no search. */
export const tableSearchPredicate = (search: TableSearch, columns: string[]) => {
  const term = search.term.trim();
  if (!term) return '';
  const targets = search.field ? [search.field] : columns;
  if (!targets.length) return '';
  const escaped = term.replace(/'/g, "''");
  return `(${targets
    .map((column) => `CAST(${quoteIdentifier(column)} AS VARCHAR) ILIKE '%${escaped}%'`)
    .join(' OR ')})`;
};

/** Convenience for the common "parse then compile" pair. */
export const searchPredicateFor = (
  raw: string,
  columns: string[],
  field?: string | null,
) => tableSearchPredicate(resolveTableSearch(raw, columns, field), columns);
