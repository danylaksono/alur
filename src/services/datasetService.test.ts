import { beforeEach, describe, expect, it, vi } from 'vitest';
import { duckdbService } from './duckdb';
import { clearDatasetMaterialisationCache, ensureStableTableDataset } from './datasetService';

const result = (rows: unknown[]) => ({ toArray: () => rows }) as any;

describe('stable table dataset identity', () => {
  beforeEach(() => { vi.restoreAllMocks(); clearDatasetMaterialisationCache(); });

  it('uses a validated existing unique identifier', async () => {
    vi.spyOn(duckdbService, 'getTableSchema').mockResolvedValue(result([{ name: 'id', type: 'VARCHAR' }, { name: 'value', type: 'DOUBLE' }]));
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce(result([{ row_count: 3 }]))
      .mockResolvedValueOnce(result([{ row_count: 3, non_null_count: 3, distinct_count: 3 }]));
    const dataset = await ensureStableTableDataset({ tableName: 'sales' });
    expect(dataset).toMatchObject({ id: 'table:sales', rowIdColumn: 'id', rowIdQuality: 'validated-unique', relationName: 'sales' });
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('materialises a stable row id when candidates are not unique', async () => {
    vi.spyOn(duckdbService, 'getTableSchema').mockResolvedValue(result([{ name: 'category', type: 'VARCHAR' }]));
    const query = vi.spyOn(duckdbService, 'query')
      .mockResolvedValueOnce(result([{ row_count: 4 }]))
      .mockResolvedValueOnce(result([{ row_count: 4, non_null_count: 4, distinct_count: 2 }]))
      .mockResolvedValueOnce(result([]));
    const dataset = await ensureStableTableDataset({ tableName: 'sales' });
    expect(dataset.rowIdQuality).toBe('materialised');
    expect(dataset.rowIdColumn).toBe('__alur_row_id');
    expect(dataset.relationName).toMatch(/^__alur_dataset_sales_/);
    expect(String(query.mock.calls[2][0])).toContain('ROW_NUMBER() OVER ()');
  });
});

