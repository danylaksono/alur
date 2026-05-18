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

export type MvtTileSource = {
    tableName: string;
    layerName: string;
    geometryKind: 'point' | 'line' | 'polygon';
    propertyColumns: string[];
    filterWhereClause?: string;
};

export type DuckDbLayerSourceMetadata = {
    kind: 'duckdb-table' | 'duckdb-query';
    tableName: string;
    originalTableName?: string;
    geometryColumn: string;
    crs: string;
    geometryKind: 'point' | 'line' | 'polygon';
    featureIdColumn: string;
    bounds?: [[number, number], [number, number]];
    fields: Array<{ name: string; type: string }>;
    tileSource: MvtTileSource;
    renderVersion: number;
};

const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;
const escapeSqlString = (value: string) => value.replace(/'/g, "''");
const mvtTableNameFor = (tableName: string) => `__ymn_mvt_${tableName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
const isSupportedMvtPropertyType = (type: string) => {
    const normalized = type.toLowerCase();
    return (
        normalized.includes('varchar') ||
        normalized.includes('string') ||
        normalized.includes('char') ||
        normalized.includes('bool') ||
        normalized.includes('int') ||
        normalized.includes('double') ||
        normalized.includes('float') ||
        normalized.includes('real') ||
        normalized.includes('decimal')
    );
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
        } catch {
            this.spatialLoaded = false;
        }

        try {
            await this.conn.query(`INSTALL h3; LOAD h3;`);
            this.h3Loaded = true;
        } catch {
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
        await this.db.flushFiles();
        return name;
    }

    async registerFileHandle(name: string, file: File) {
        if (!this.db) throw new Error('DuckDB not initialized');
        await this.db.registerFileHandle(name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, false);
        await this.db.flushFiles();
        return name;
    }

    async registerUploadedFile(name: string, file: File, kind: 'parquet' | 'csv') {
        if (!this.db) throw new Error('DuckDB not initialized');

        const candidates = [name, `/${name}`];
        const probe = async (path: string) => {
            const escaped = escapeSqlString(path);
            if (kind === 'parquet') {
                await this.query(`SELECT * FROM read_parquet('${escaped}') LIMIT 0;`);
            } else {
                await this.query(`SELECT * FROM read_csv_auto('${escaped}') LIMIT 0;`);
            }
        };

        const errors: string[] = [];

        const buffer = new Uint8Array(await file.arrayBuffer());
        for (const path of candidates) {
            try {
                await this.db.dropFile(path).catch(() => null);
                await this.registerFileBuffer(path, buffer);
                await probe(path);
                return path;
            } catch (err: any) {
                errors.push(`buffer ${path}: ${err?.message || String(err)}`);
            }
        }

        for (const path of candidates) {
            try {
                await this.db.dropFile(path).catch(() => null);
                await this.registerFileHandle(path, file);
                await probe(path);
                return path;
            } catch (err: any) {
                errors.push(`file handle ${path}: ${err?.message || String(err)}`);
            }
        }

        let mountedFiles = '';
        try {
            const files = await this.db.globFiles('*');
            mountedFiles = ` Mounted files: ${files.map((item: any) => item.fileName || item.name || item.path || JSON.stringify(item)).join(', ') || 'none'}.`;
        } catch {
            mountedFiles = '';
        }

        throw new Error(`DuckDB could not read ${file.name}.${mountedFiles} ${errors.join(' | ')}`);
    }

    async registerFileUrl(name: string, url: string) {
        if (!this.db) throw new Error('DuckDB not initialized');
        // Use DuckDB Wasm's native URL registration
        await this.db.registerFileURL(name, url, duckdb.DuckDBDataProtocol.HTTP, false);
        await this.db.flushFiles();
        return name;
    }

    async registerJsonRows(tableName: string, rows: Record<string, unknown>[]) {
        if (!this.db || !this.conn) throw new Error('DuckDB not initialized');
        const fileName = `${tableName}.json`;
        await this.db.registerFileText(fileName, JSON.stringify(rows));
        await this.conn.query(`DROP TABLE IF EXISTS "${tableName}";`);
        try {
            await this.conn.insertJSONFromPath(fileName, {
                schema: 'main',
                name: tableName,
            });
        } catch (err) {
            // Retry once after dropping again (handles race conditions)
            await this.conn.query(`DROP TABLE IF EXISTS "${tableName}";`);
            await this.conn.insertJSONFromPath(fileName, {
                schema: 'main',
                name: tableName,
            });
        }
    }

    async optimizeTable(tableName: string) {
        if (!this.conn || !this.spatialLoaded) return;
        try {
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
                
                try {
                    await this.conn.query(`CREATE INDEX IF NOT EXISTS ${tableName}_spatial_idx ON "${tableName}" USING RTREE(${geomCol});`);
                } catch {
                    // Index creation can fail if the table is a CTE, view, or not a base table
                }
            }
        } catch {
            // Table might not be queryable yet
        }
    }

    async getTableSchema(tableName: string) {
        return await this.query(`PRAGMA table_info('${tableName}');`);
    }

    private async getTableSchemaRows(tableName: string) {
        const info = await this.query(`PRAGMA table_info('${escapeSqlString(tableName)}');`);
        return info.toArray().map((row: any) => typeof row.toJSON === 'function' ? row.toJSON() : row);
    }

    private geometryExpression(columns: any[]) {
        const geomColStrict = columns.find((col: any) => {
            const type = String(col.type || '').toLowerCase();
            return type === 'geometry';
        });

        if (geomColStrict?.name) {
            return qi(geomColStrict.name);
        }

        const wkbCol = columns.find((col: any) => {
            const name = String(col.name || '').toLowerCase();
            const type = String(col.type || '').toLowerCase();
            return (
                (name === 'geometry' || name === 'geom' || name === 'wkb_geometry') &&
                (type === 'blob' || type === 'binary' || type.includes('blob'))
            );
        });

        if (wkbCol?.name) {
            return `ST_GeomFromWKB(${qi(wkbCol.name)})`;
        }

        const latCol = columns.find((col: any) => {
            const name = String(col.name || '').toLowerCase();
            return name === 'latitude' || name === 'lat' || name === 'y';
        });
        const lonCol = columns.find((col: any) => {
            const name = String(col.name || '').toLowerCase();
            return name === 'longitude' || name === 'lon' || name === 'lng' || name === 'x';
        });

        if (latCol?.name && lonCol?.name) {
            return `ST_Point(CAST(${qi(lonCol.name)} AS DOUBLE), CAST(${qi(latCol.name)} AS DOUBLE))`;
        }

        return null;
    }

    private propertyColumnsForMvt(columns: any[]) {
        return columns
            .filter((col: any) => {
                const name = String(col.name || '');
                const loweredName = name.toLowerCase();
                const type = String(col.type || '');
                return (
                    name &&
                    !['geojson', 'geometry', 'geom', 'wkb_geometry', 'geometry_bbox'].includes(loweredName) &&
                    !loweredName.startsWith('__ymn_') &&
                    isSupportedMvtPropertyType(type)
                );
            })
            .map((col: any) => String(col.name));
    }

    private fieldsForLayerSource(columns: any[]) {
        return columns
            .map((col: any) => ({ name: String(col.name || ''), type: String(col.type || '') }))
            .filter((col) => {
                const lower = col.name.toLowerCase();
                const type = col.type.toLowerCase();
                return (
                    col.name &&
                    !['geojson', 'geometry', 'geom', 'wkb_geometry', 'geometry_bbox'].includes(lower) &&
                    !lower.startsWith('__ymn_') &&
                    !type.includes('geometry') &&
                    !type.includes('blob') &&
                    !type.includes('binary')
                );
            });
    }

    private async layerBounds(tableName: string, geomExpr: string): Promise<[[number, number], [number, number]] | undefined> {
        try {
            const result = await this.query(`
                WITH extent AS (
                    SELECT ST_Extent_Agg(${geomExpr}) AS bbox
                    FROM ${qi(tableName)}
                    WHERE ${geomExpr} IS NOT NULL
                )
                SELECT
                    ST_XMin(bbox) AS min_x,
                    ST_YMin(bbox) AS min_y,
                    ST_XMax(bbox) AS max_x,
                    ST_YMax(bbox) AS max_y
                FROM extent
                WHERE bbox IS NOT NULL;
            `);
            const rawRow = result.toArray()[0];
            const row = typeof rawRow?.toJSON === 'function' ? rawRow.toJSON() : rawRow;
            const minX = Number(row?.min_x);
            const minY = Number(row?.min_y);
            const maxX = Number(row?.max_x);
            const maxY = Number(row?.max_y);
            if (![minX, minY, maxX, maxY].every(Number.isFinite)) return undefined;
            if (minX < -180 || maxX > 180 || minY < -90 || maxY > 90) return undefined;
            return [[minX, minY], [maxX, maxY]];
        } catch {
            return undefined;
        }
    }

    private geometryKindFromType(type: string): MvtTileSource['geometryKind'] {
        const normalized = type.toUpperCase();
        if (normalized.includes('LINE')) return 'line';
        if (normalized.includes('POLYGON')) return 'polygon';
        return 'point';
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

    async prepareMvtTileSource(tableName: string, options: { filterWhereClause?: string } = {}): Promise<MvtTileSource | null> {
        if (!this.spatialLoaded) return null;

        const columns = await this.getTableSchemaRows(tableName);
        const geomExpr = this.geometryExpression(columns);
        if (!geomExpr) return null;

        const sourceTable = qi(tableName);
        const tileTable = mvtTableNameFor(tableName);
        const propertyColumns = this.propertyColumnsForMvt(columns);
        const propertySelect = propertyColumns.length
            ? `, ${propertyColumns.map((name) => qi(name)).join(', ')}`
            : '';

        await this.query(`
            CREATE OR REPLACE TABLE ${qi(tileTable)} AS
            SELECT
                ROW_NUMBER() OVER ()::BIGINT AS __ymn_mvt_id,
                ST_Transform(${geomExpr}, 'EPSG:4326', 'EPSG:3857', true) AS __ymn_tile_geom
                ${propertySelect}
            FROM ${sourceTable}
            WHERE ${geomExpr} IS NOT NULL;
        `);

        const typeResult = await this.query(
            `SELECT ST_GeometryType(__ymn_tile_geom) AS geometry_type FROM ${qi(tileTable)} WHERE __ymn_tile_geom IS NOT NULL LIMIT 1;`
        );
        const typeRaw = typeResult.toArray()[0];
        const typeRow = typeof typeRaw?.toJSON === 'function' ? typeRaw.toJSON() : typeRaw;
        if (!typeRow?.geometry_type) return null;

        return {
            tableName: tileTable,
            layerName: 'features',
            geometryKind: this.geometryKindFromType(String(typeRow.geometry_type)),
            propertyColumns,
            filterWhereClause: options.filterWhereClause,
        };
    }

    async prepareLayerSource(
        tableName: string,
        options: { kind?: 'duckdb-table' | 'duckdb-query'; originalTableName?: string; filterWhereClause?: string } = {},
    ): Promise<DuckDbLayerSourceMetadata | null> {
        if (!this.spatialLoaded) return null;

        const columns = await this.getTableSchemaRows(tableName);
        const geomExpr = this.geometryExpression(columns);
        if (!geomExpr) return null;

        const tileSource = await this.prepareMvtTileSource(tableName, { filterWhereClause: options.filterWhereClause });
        if (!tileSource) return null;

        const geomCol = columns.find((col: any) => String(col.type || '').toLowerCase() === 'geometry')
            || columns.find((col: any) => ['geometry', 'geom', 'wkb_geometry'].includes(String(col.name || '').toLowerCase()))
            || { name: 'geometry' };

        return {
            kind: options.kind ?? 'duckdb-table',
            tableName,
            originalTableName: options.originalTableName ?? tableName,
            geometryColumn: String(geomCol.name || 'geometry'),
            crs: 'EPSG:4326',
            geometryKind: tileSource.geometryKind,
            featureIdColumn: '__ymn_mvt_id',
            bounds: await this.layerBounds(tableName, geomExpr),
            fields: this.fieldsForLayerSource(columns),
            tileSource,
            renderVersion: Date.now(),
        };
    }

    async materializeQueryAsTable(sql: string, tableName: string) {
        await this.query(`CREATE OR REPLACE TABLE ${qi(tableName)} AS ${sql};`);
        return tableName;
    }

    async getTableFeatureCount(tableName: string) {
        const result = await this.query(`SELECT COUNT(*) AS feature_count FROM ${qi(tableName)};`);
        const rawRow = result.toArray()[0];
        const row = typeof rawRow?.toJSON === 'function' ? rawRow.toJSON() : rawRow;
        return Number(row?.feature_count ?? row?.count_star ?? 0);
    }

    async getMvtTile(source: MvtTileSource, z: number, x: number, y: number): Promise<ArrayBuffer> {
        const propertyEntries = source.propertyColumns
            .map((name) => `${JSON.stringify(name)}: ${qi(name)}`)
            .join(', ');
        const properties = propertyEntries ? `, ${propertyEntries}` : '';
        const filterClause = source.filterWhereClause
            ? `AND (${source.filterWhereClause.replace(/^WHERE\s+/i, '')})`
            : '';
        const result = await this.query(`
            WITH bounds AS (
                SELECT ST_TileEnvelope(${z}, ${x}, ${y}) AS tile_bounds
            ),
            tile_rows AS (
                SELECT {
                    "geom": ST_AsMVTGeom(__ymn_tile_geom, ST_Extent(tile_bounds), 4096, 64, true),
                    "__ymn_mvt_id": __ymn_mvt_id,
                    "_ymn_feature_id": CAST(__ymn_mvt_id AS VARCHAR)
                    ${properties}
                } AS tile_row
                FROM ${qi(source.tableName)}, bounds
                WHERE ST_Intersects(__ymn_tile_geom, tile_bounds)
                ${filterClause}
            )
            SELECT ST_AsMVT(tile_row, ${`'${escapeSqlString(source.layerName)}'`}, 4096, 'geom', '__ymn_mvt_id') AS tile
            FROM tile_rows;
        `);
        const rawRow = result.toArray()[0];
        const row = typeof rawRow?.toJSON === 'function' ? rawRow.toJSON() : rawRow;
        const tile = row?.tile;
        if (!tile) return new ArrayBuffer(0);
        if (tile instanceof Uint8Array) {
            const copy = new Uint8Array(tile.byteLength);
            copy.set(tile);
            return copy.buffer;
        }
        if (tile?.buffer instanceof ArrayBuffer && tile?.byteLength !== undefined) {
            const view = new Uint8Array(tile.buffer, tile.byteOffset ?? 0, tile.byteLength);
            const copy = new Uint8Array(view.byteLength);
            copy.set(view);
            return copy.buffer;
        }
        return new ArrayBuffer(0);
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
