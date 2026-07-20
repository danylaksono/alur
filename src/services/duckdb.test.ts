import { describe, expect, it } from 'vitest';
import { mvtPropertyTypeForDuckDbType } from './duckdb';

describe('mvtPropertyTypeForDuckDbType', () => {
    it('rejects nested DuckDB types even when their fields use supported scalar types', () => {
        expect(mvtPropertyTypeForDuckDbType(
            'STRUCT(xmax DOUBLE, xmin DOUBLE, ymax DOUBLE, ymin DOUBLE)',
        )).toBeNull();
        expect(mvtPropertyTypeForDuckDbType('DOUBLE[]')).toBeNull();
        expect(mvtPropertyTypeForDuckDbType('LIST(INTEGER)')).toBeNull();
        expect(mvtPropertyTypeForDuckDbType('MAP(VARCHAR, DOUBLE)')).toBeNull();
    });

    it('returns the canonical ST_AsMVT property type for supported scalars', () => {
        expect(mvtPropertyTypeForDuckDbType('VARCHAR')).toBe('VARCHAR');
        expect(mvtPropertyTypeForDuckDbType('BOOLEAN')).toBe('BOOLEAN');
        expect(mvtPropertyTypeForDuckDbType('SMALLINT')).toBe('INTEGER');
        expect(mvtPropertyTypeForDuckDbType('DECIMAL(18, 4)')).toBe('DOUBLE');
        expect(mvtPropertyTypeForDuckDbType('REAL')).toBe('FLOAT');
    });
});
