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
    private spatialLoaded = false;
    private h3Loaded = false;

    async init() {
        if (this.initialized) return;

        const bundle = await duckdb.selectBundle(MANUAL_BUNDLES);
        const worker = new Worker(bundle.mainWorker!);
        const logger = new duckdb.ConsoleLogger();
        const db = new duckdb.AsyncDuckDB(logger, worker);
        await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
        
        this.db = db;
        this.conn = await db.connect();
        
        try {
            await this.conn.query(`INSTALL spatial; LOAD spatial;`);
            this.spatialLoaded = true;
        } catch (e) {
            this.spatialLoaded = false;
        }

        try {
            await this.conn.query(`INSTALL h3; LOAD h3;`);
            this.h3Loaded = true;
        } catch (e) {
            this.h3Loaded = false;
        }
        
        this.initialized = true;
    }

    get isSpatialLoaded() {
        return this.spatialLoaded;
    }

    get isH3Loaded() {
        return this.h3Loaded;
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

    async registerFileUrl(name: string, url: string) {
        if (!this.db) throw new Error('DuckDB not initialized');
        // Use DuckDB Wasm's native URL registration
        await this.db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false);
        return name;
    }

    async optimizeTable(tableName: string) {
        if (!this.conn || !this.spatialLoaded) return;
        try {
            // Check if geometry column exists
            const info = await this.getTableSchema(tableName);
            const columns = info.toArray();
            const hasGeom = columns.some((c: any) => {
                const name = String(c.name).toLowerCase();
                return name === 'geometry' || name === 'geom';
            });

            if (hasGeom) {
                const geomCol = columns.find((c: any) => {
                    const name = String(c.name).toLowerCase();
                    return name === 'geometry' || name === 'geom';
                }).name;
                
                await this.conn.query(`CREATE INDEX IF NOT EXISTS ${tableName}_spatial_idx ON "${tableName}" USING RTREE(${geomCol});`);
            }
        } catch (e) {
            console.warn(`Optimization failed for ${tableName}:`, e);
        }
    }

    async getTableSchema(tableName: string) {
        return await this.query(`PRAGMA table_info('${tableName}');`);
    }

    private normalizeValue(value: any): any {
        if (value === null || value === undefined) return value;
        if (typeof value === 'bigint') return value.toString();
        if (value instanceof Uint8Array || (value?.buffer instanceof ArrayBuffer && value?.byteLength !== undefined)) {
            // Binary blob — skip (geometry in WKB form, handled separately)
            return null;
        }
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
                // Remove geometry_bbox if present
                delete properties['geometry_bbox'];
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

    private resultToGeoJSONFromLatLon(result: any, latField: string, lonField: string) {
        const rows = result.toArray();
        const features = rows.map((row: any) => {
            const raw = typeof row.toJSON === 'function' ? row.toJSON() : row;
            const lat = Number(raw[latField]);
            const lon = Number(raw[lonField]);
            if (isNaN(lat) || isNaN(lon)) return null;

            const properties = this.normalizeValue({ ...raw });
            delete properties['geometry'];
            delete properties['geometry_bbox'];
            return {
                type: 'Feature',
                geometry: {
                    type: 'Point',
                    coordinates: [lon, lat],
                },
                properties,
            };
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

    async getGeoJSONFromTable(tableName: string, limit = 5000) {
        const info = await this.query(`PRAGMA table_info('${tableName}');`);
        const columns = info.toArray().map((row: any) => typeof row.toJSON === 'function' ? row.toJSON() : row);

        // 1) Look for a proper geometry column (type = GEOMETRY)
        const geomColStrict = columns.find((col: any) => {
            const type = String(col.type || '').toLowerCase();
            return type === 'geometry';
        });

        if (geomColStrict?.name && this.spatialLoaded) {
            const result = await this.query(
                `SELECT *, ST_AsGeoJSON(${geomColStrict.name}) AS geojson FROM "${tableName}" LIMIT ${limit};`
            );
            const fc = this.resultToGeoJSON(result, 'geojson');
            if (fc.features.length) return fc;
        }

        // 2) WKB binary column named 'geometry' or 'geom' with spatial loaded
        if (this.spatialLoaded) {
            const wkbCol = columns.find((col: any) => {
                const name = String(col.name || '').toLowerCase();
                const type = String(col.type || '').toLowerCase();
                return (
                    (name === 'geometry' || name === 'geom' || name === 'wkb_geometry') &&
                    (type === 'blob' || type === 'binary' || type.includes('blob'))
                );
            });

            if (wkbCol?.name) {
                try {
                    const result = await this.query(
                        `SELECT *, ST_AsGeoJSON(ST_GeomFromWKB(${wkbCol.name})) AS geojson FROM "${tableName}" LIMIT ${limit};`
                    );
                    const fc = this.resultToGeoJSON(result, 'geojson');
                    if (fc.features.length) return fc;
                } catch (e) {
                    console.warn('WKB geometry conversion failed:', e);
                }
            }
        }

        // 3) Fallback: Latitude/Longitude columns
        const latCol = columns.find((col: any) => {
            const name = String(col.name || '').toLowerCase();
            return name === 'latitude' || name === 'lat' || name === 'y';
        });
        const lonCol = columns.find((col: any) => {
            const name = String(col.name || '').toLowerCase();
            return name === 'longitude' || name === 'lon' || name === 'lng' || name === 'x';
        });

        if (latCol?.name && lonCol?.name) {
            const result = await this.query(
                `SELECT * FROM "${tableName}" WHERE "${latCol.name}" IS NOT NULL AND "${lonCol.name}" IS NOT NULL LIMIT ${limit};`
            );
            const fc = this.resultToGeoJSONFromLatLon(result, latCol.name, lonCol.name);
            if (fc.features.length) return fc;
        }

        return null;
    }

    async exportTable(sql: string, format: 'parquet' | 'csv' | 'json' = 'parquet'): Promise<{ buffer: Uint8Array; fileName: string }> {
        if (!this.db || !this.conn) throw new Error('DuckDB not initialized');

        const fileName = `export_${Date.now()}.${format}`;
        let copySql = '';

        switch (format) {
            case 'parquet':
                copySql = `COPY (${sql}) TO '${fileName}' (FORMAT PARQUET);`;
                break;
            case 'csv':
                copySql = `COPY (${sql}) TO '${fileName}' (FORMAT CSV, HEADER);`;
                break;
            case 'json':
                copySql = `COPY (${sql}) TO '${fileName}' (FORMAT JSON);`;
                break;
        }

        await this.conn.query(copySql);
        const buffer = await this.db.copyFileToBuffer(fileName);
        return { buffer, fileName };
    }
}

export const duckdbService = new DuckDBService();
