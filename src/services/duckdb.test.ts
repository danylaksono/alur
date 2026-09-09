import { describe, expect, it, vi } from 'vitest';
import { duckdbService, mvtPropertyTypeForDuckDbType, tileSampleModulus } from './duckdb';

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

describe('query scheduling', () => {
    /** Fakes the one shared connection, with each query held open until released. */
    const stub = () => {
        const started: string[] = [];
        const pending: Array<() => void> = [];
        const service = duckdbService as unknown as { db: unknown; conn: unknown };
        service.conn = {
            query: async (sql: string) => {
                started.push(sql);
                await new Promise<void>((resolve) => pending.push(resolve));
                return { toArray: () => [] };
            },
        };
        return {
            started,
            releaseAll: () => { pending.splice(0).forEach((done) => done()); },
            restore: () => { service.db = null; service.conn = null; },
        };
    };
    const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

    it('holds a background query back while foreground work is outstanding', async () => {
        const { started, releaseAll, restore } = stub();

        const foreground = duckdbService.query('SELECT foreground');
        const background = duckdbService.backgroundQuery('SELECT tile');
        await settle();

        expect(started).toEqual(['SELECT foreground']);

        releaseAll();
        await foreground;
        await settle();
        expect(started).toEqual(['SELECT foreground', 'SELECT tile']);

        releaseAll();
        await background;
        restore();
    });

    it('never runs a background query whose request was already abandoned', async () => {
        const { started, restore } = stub();
        const controller = new AbortController();
        controller.abort();

        await expect(duckdbService.backgroundQuery('SELECT tile', controller.signal))
            .rejects.toMatchObject({ name: 'AbortError' });
        expect(started).toEqual([]);
        restore();
    });

    it('stops giving way once the yield window closes, so tiles cannot starve', async () => {
        vi.useFakeTimers();
        const { started, releaseAll, restore } = stub();
        try {
            // Foreground work that never settles: without a bound, the tile
            // behind it would wait forever and the map would stay blank.
            void duckdbService.query('SELECT endless');
            const background = duckdbService.backgroundQuery('SELECT tile');

            await vi.advanceTimersByTimeAsync(1000);
            expect(started).toEqual(['SELECT endless']);

            await vi.advanceTimersByTimeAsync(1500);
            expect(started).toEqual(['SELECT endless', 'SELECT tile']);

            releaseAll();
            await background;
        } finally {
            vi.useRealTimers();
            restore();
        }
    });

    it('reports foreground work so the tile queue can throttle itself', async () => {
        const { releaseAll, restore } = stub();
        expect(duckdbService.hasForegroundWork).toBe(false);

        const foreground = duckdbService.query('SELECT 1');
        expect(duckdbService.hasForegroundWork).toBe(true);

        releaseAll();
        await foreground;
        expect(duckdbService.hasForegroundWork).toBe(false);
        restore();
    });
});

describe('tileSampleModulus', () => {
    it('draws every feature from zoom 9 up, where a tile is already affordable', () => {
        [9, 10, 12, 16, 22].forEach((z) => expect(tileSampleModulus(z)).toBe(1));
    });

    it('thins low zooms toward the density a z9 tile already carries', () => {
        // Measured features per tile on the 946k-polygon building layer:
        // z8 278k, z7 500k, z6 946k, against 32k unsampled at z9.
        expect(278_006 / tileSampleModulus(8)).toBeLessThan(40_000);
        expect(500_269 / tileSampleModulus(7)).toBeLessThan(40_000);
        expect(946_492 / tileSampleModulus(6)).toBeLessThan(40_000);
    });

    it('thins monotonically as the tile covers more ground', () => {
        expect(tileSampleModulus(8)).toBeLessThan(tileSampleModulus(7));
        expect(tileSampleModulus(7)).toBeLessThan(tileSampleModulus(6));
        expect(tileSampleModulus(5)).toBeGreaterThanOrEqual(tileSampleModulus(6));
    });
});
