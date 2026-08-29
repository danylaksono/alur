import { describe, expect, it } from 'vitest';
import { duckdbService, mvtPropertyTypeForDuckDbType } from './duckdb';

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

/**
 * Reading rows of JSON into a table.
 *
 * duckdb-wasm's `insertJSONFromPath` **silently truncates to the first 100
 * columns** — no error, no warning, just missing data whose identity depends on
 * key order. A calculation's output is the original row plus its new values, so
 * a wide dataset pushed the geometry key past the hundredth and the result
 * arrived with no geometry at all, failing later and somewhere else entirely.
 *
 * These drive the real method against a stub connection, because what matters is
 * which reader it asks for. The column count itself can only be proved in a
 * browser, where it has been.
 */
describe('registerJsonRows', () => {
    const stub = () => {
        const queries: string[] = [];
        const service = duckdbService as unknown as {
            db: unknown;
            conn: unknown;
        };
        service.db = { registerFileText: async () => undefined };
        service.conn = { query: async (sql: string) => { queries.push(sql); } };
        return {
            queries,
            restore: () => { service.db = null; service.conn = null; },
        };
    };

    it('reads through read_json_auto, which has no column cap', async () => {
        const { queries, restore } = stub();
        await duckdbService.registerJsonRows('probe', [{ a: 1 }]);
        expect(queries.join(' ')).toContain('read_json_auto');
        restore();
    });

    it('never reaches for insertJSONFromPath, which truncates at 100 columns', async () => {
        const { queries, restore } = stub();
        // The stub has no `insertJSONFromPath`; calling it would throw rather
        // than pass, which is precisely the failure this test is here to catch.
        await duckdbService.registerJsonRows('probe', [{ a: 1 }]);
        expect(queries.some((sql) => sql.includes('CREATE OR REPLACE TABLE'))).toBe(true);
        restore();
    });

    it('quotes the table name, so an odd name cannot break out of the statement', async () => {
        const { queries, restore } = stub();
        await duckdbService.registerJsonRows('weird"name', [{ a: 1 }]);
        expect(queries.join(' ')).toContain('"weird""name"');
        restore();
    });
});
