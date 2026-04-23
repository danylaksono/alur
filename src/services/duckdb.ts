import * as duckdb from '@duckdb/duckdb-wasm';
import duckdb_wasm from '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url';
import mvp_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url';
import duckdb_wasm_eh from '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url';
import eh_worker from '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url';

const MANUAL_BUNDLES: duckdb.DuckDBBundles = {
    mvp: {
        mainModule: duckdb_wasm,
        mainWorker: mvp_worker,
    },
    eh: {
        mainModule: duckdb_wasm_eh,
        mainWorker: eh_worker,
    },
};

class DuckDBService {
    private db: duckdb.AsyncDuckDB | null = null;
    private conn: duckdb.AsyncDuckDBConnection | null = null;
    private initialized = false;

    async init() {
        if (this.initialized) return;

        const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
        const worker = new Worker(bundle.mainWorker!);
        const logger = new duckdb.ConsoleLogger();
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        
        this.db = db;
        this.conn = await db.connect();
        
        // Load spatial extension
        // Note: In Wasm, we might need to INSTALL/LOAD from a remote repository
        await this.conn.query(`INSTALL spatial; LOAD spatial;`);
        
        this.initialized = true;
        console.log('DuckDB Wasm with Spatial initialized');
    }

    async query(sql: string) {
        if (!this.conn) throw new Error('DuckDB not initialized');
        return await this.conn.query(sql);
    }

    async registerFileBuffer(name: string, buffer: Uint8Array) {
        if (!this.db) throw new Error('DuckDB not initialized');
        await this.db.registerFileBuffer(name, buffer);
        return name;
    }

    async getTableSchema(tableName: string) {
        return await this.query(`PRAGMA table_info('${tableName}');`);
    }

    private normalizeValue(value: any): any {
        if (value === null || value === undefined) return value;
        if (typeof value === 'bigint') return value.toString();
        if (Array.isArray(value)) return value.map((item) => this.normalizeValue(item));
        if (typeof value === 'object') {
            return Object.fromEntries(
                Object.entries(value).map(([key, item]) => [key, this.normalizeValue(item)])
            );
        }
        return value;
    }

    private resultToGeoJSON(result: any, geojsonField: string) {
        const rows = result.toArray();
        const features = rows.map((row: any) => {
            const raw = typeof row.toJSON === 'function' ? row.toJSON() : row;
            const geojsonText = raw[geojsonField];
            if (!geojsonText) return null;

            try {
                const geometry = JSON.parse(geojsonText);
                const properties = this.normalizeValue({ ...raw });
                delete properties[geojsonField];
                return {
                    type: 'Feature',
                    geometry,
                    properties,
                };
            } catch {
                return null;
            }
        }).filter(Boolean) as GeoJSON.Feature[];

        return {
            type: 'FeatureCollection' as const,
            features,
        };
    }
    
    async getGeoJSON(sql: string) {
        const result = await this.query(sql);
        return this.resultToGeoJSON(result, 'geojson');
    }

    async getGeoJSONFromTable(tableName: string) {
        const info = await this.query(`PRAGMA table_info('${tableName}');`);
        const columns = info.toArray().map((row: any) => typeof row.toJSON === 'function' ? row.toJSON() : row);
        const geometryColumn = columns.find((column: any) => {
            const name = String(column.name || '').toLowerCase();
            const type = String(column.type || '').toLowerCase();
            return type.includes('geometry') || name.includes('geom') || name.includes('geometry');
        });

        if (!geometryColumn?.name) {
            return null;
        }

        const result = await this.query(`SELECT *, ST_AsGeoJSON(${geometryColumn.name}) AS geojson FROM "${tableName}" LIMIT 2000;`);
        const featureCollection = this.resultToGeoJSON(result, 'geojson');

        if (!featureCollection.features.length) {
            return null;
        }

        return featureCollection;
    }
}

export const duckdbService = new DuckDBService();
