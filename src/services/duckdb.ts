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
    /** Subset embedded in map tiles; omitted means all available properties. */
    renderPropertyColumns?: string[];
    filterWhereClause?: string;
};

export type DuckDbLayerSourceMetadata = {
    kind: 'duckdb-table' | 'duckdb-query';
    tableName: string;
    originalTableName?: string;
    geometryColumn: string;
    crs: string;
    crsName?: string;
    crsConfidence?: 'high' | 'medium' | 'low';
    crsReason?: string;
    geometryKind: 'point' | 'line' | 'polygon';
    featureIdColumn: string;
    bounds?: [[number, number], [number, number]];
    fields: Array<{ name: string; type: string }>;
    tileSource: MvtTileSource;
    renderVersion: number;
};

type LayerExtent = {
    minX: number;
    minY: number;
    maxX: number;
    maxY: number;
};

type CrsEstimate = {
    code: string;
    name: string;
    confidence: 'high' | 'medium' | 'low';
    reason: string;
    transformCrs: string;
};

const qi = (name: string) => `"${name.replace(/"/g, '""')}"`;
const escapeSqlString = (value: string) => value.replace(/'/g, "''");
const mvtTableNameFor = (tableName: string) => `__alur_mvt_${tableName.replace(/[^a-zA-Z0-9_]/g, '_')}`;
const withFileNameSuffix = (path: string, suffix: string) => {
    const slashIndex = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    const directory = slashIndex >= 0 ? path.slice(0, slashIndex + 1) : '';
    const fileName = slashIndex >= 0 ? path.slice(slashIndex + 1) : path;
    const dotIndex = fileName.lastIndexOf('.');

    if (dotIndex > 0) {
        return `${directory}${fileName.slice(0, dotIndex)}${suffix}${fileName.slice(dotIndex)}`;
    }

    return `${path}${suffix}`;
};
type MvtPropertyType = 'VARCHAR' | 'FLOAT' | 'DOUBLE' | 'INTEGER' | 'BIGINT' | 'BOOLEAN';

export const mvtPropertyTypeForDuckDbType = (type: string): MvtPropertyType | null => {
    const normalized = type.trim().toUpperCase();
    if (normalized.includes('[')) return null;

    const baseType = normalized.match(/^[A-Z]+/)?.[0] ?? '';

    switch (baseType) {
        case 'VARCHAR':
        case 'STRING':
        case 'CHAR':
        case 'CHARACTER':
        case 'BPCHAR':
            return 'VARCHAR';
        case 'BOOLEAN':
        case 'BOOL':
            return 'BOOLEAN';
        case 'TINYINT':
        case 'SMALLINT':
        case 'INTEGER':
        case 'INT':
            return 'INTEGER';
        case 'BIGINT':
        case 'UTINYINT':
        case 'USMALLINT':
        case 'UINTEGER':
            return 'BIGINT';
        case 'FLOAT':
        case 'REAL':
            return 'FLOAT';
        case 'DOUBLE':
            return 'DOUBLE';
        case 'DECIMAL':
        case 'NUMERIC':
        case 'UBIGINT':
        case 'HUGEINT':
        case 'UHUGEINT':
            return 'DOUBLE';
        default:
            return null;
    }
};

class DuckDBService {
    private db: duckdb.AsyncDuckDB | null = null;
    private conn: duckdb.AsyncDuckDBConnection | null = null;
    private initialized = false;
    private spatialLoaded = false;
    private h3Loaded = false;
    private httpfsLoaded = false;

    private initPromise: Promise<void> | null = null;
    private h3Promise: Promise<boolean> | null = null;
    private httpfsPromise: Promise<boolean> | null = null;

    /**
     * Idempotent + concurrency-safe: React StrictMode double-mounts effects, and
     * two overlapping init() calls used to create TWO DuckDB workers with
     * registrations and queries split between them ("No files found" on ~50%
     * of uploads). A single shared promise guarantees one worker.
     */
    async init() {
        if (!this.initPromise) {
            this.initPromise = this.doInit().catch((err) => {
                this.initPromise = null;
                throw err;
            });
        }
        return this.initPromise;
    }

    private async doInit() {
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

        this.initialized = true;
    }

    get isSpatialLoaded() {
        return this.spatialLoaded;
    }

    /** Whether h3 has already been loaded. Use `ensureH3()` to load it. */
    get isH3Loaded() {
        return this.h3Loaded;
    }

    /**
     * Loads the community h3 extension on first use, never at startup.
     *
     * Two reasons it is lazy. It costs a network round trip — measured at ~1.8s
     * cold — and ALUR otherwise runs entirely offline once loaded, so every
     * session should not pay for a capability most of them never touch.
     *
     * The historical reason it was absent is gone: on duckdb-wasm 1.28 a loaded
     * community extension broke registerFileHandle/registerFileBuffer for the
     * rest of the session, so no file could be opened afterwards. Retested on
     * 1.32 — file registration survives repeated loads, verified in a browser.
     *
     * Returns false rather than throwing when the extension cannot be fetched,
     * because every caller has a working fallback and being offline is not an
     * error. A failure is not cached, so a later attempt can still succeed.
     */
    async ensureH3(): Promise<boolean> {
        if (this.h3Loaded) return true;
        if (!this.h3Promise) {
            this.h3Promise = (async () => {
                await this.init();
                if (!this.conn) return false;
                try {
                    await this.conn.query(`INSTALL h3 FROM community; LOAD h3;`);
                    this.h3Loaded = true;
                    return true;
                } catch {
                    this.h3Promise = null;
                    return false;
                }
            })();
        }
        return this.h3Promise;
    }

    /**
     * Loads httpfs on first remote read, never at startup.
     *
     * This is what makes reading a file over the web cheap, and nothing else
     * does. duckdb-wasm's own HTTP runtime answers a scan by downloading the
     * whole object: measured against a 2.7 MB GeoParquet it fetched all
     * 2.7 MB, and the `reliableHeadRequests` / `allowFullHTTPReads` filesystem
     * config did not change that. With httpfs loaded the same query is served
     * by one 16 KB ranged GET of the Parquet footer, and a bbox-filtered count
     * over Overture's 576 MB divisions file costs ~834 KB because row-group
     * statistics let it skip the rest.
     *
     * Lazy for the same reason as `ensureH3()`: it costs a network round trip,
     * and a session that only ever opens local files should not pay for it.
     * Returns false rather than throwing so callers can report the loss of
     * range requests as the specific problem it is.
     */
    async ensureHttpfs(): Promise<boolean> {
        if (this.httpfsLoaded) return true;
        if (!this.httpfsPromise) {
            this.httpfsPromise = (async () => {
                await this.init();
                if (!this.conn) return false;
                try {
                    await this.conn.query(`INSTALL httpfs; LOAD httpfs;`);
                    this.httpfsLoaded = true;
                    return true;
                } catch {
                    this.httpfsPromise = null;
                    return false;
                }
            })();
        }
        return this.httpfsPromise;
    }

    async query(sql: string) {
        if (!this.conn) throw new Error('DuckDB not initialized');
        return await this.conn.query(sql);
    }

    async registerFileBuffer(name: string, buffer: Uint8Array) {
        if (!this.db) throw new Error('DuckDB not initialized');
        await this.db.registerFileBuffer(name, new Uint8Array(buffer));
        await this.db.flushFiles();
        return name;
    }

    async registerFileHandle(name: string, file: File, directIO = true) {
        if (!this.db) throw new Error('DuckDB not initialized');
        await this.db.registerFileHandle(name, file, duckdb.DuckDBDataProtocol.BROWSER_FILEREADER, directIO);
        await this.db.flushFiles();
        return name;
    }

    async registerUploadedFile(name: string, file: File, kind: 'parquet' | 'csv') {
        if (!this.db) throw new Error('DuckDB not initialized');

        const scanExpressions = (path: string) => {
            const escaped = escapeSqlString(path);
            if (kind === 'parquet') {
                return [`read_parquet('${escaped}')`, `'${escaped}'`];
            }
            return [`read_csv_auto('${escaped}')`];
        };
        const probe = async (path: string) => {
            const errors: string[] = [];
            for (const scanSql of scanExpressions(path)) {
                try {
                    await this.query(`SELECT * FROM ${scanSql} LIMIT 0;`);
                    return scanSql;
                } catch (err: any) {
                    errors.push(`${scanSql}: ${err?.message || String(err)}`);
                }
            }
            throw new Error(errors.join(' | '));
        };

        const errors: string[] = [];
        const handleFallbackPath = withFileNameSuffix(name, '__handle');
        const bufferFallbackPath = withFileNameSuffix(name, '__buffer');
        const attempts: Array<{
            label: string;
            path: string;
            register: () => Promise<void>;
        }> = [
            {
                label: 'file handle',
                path: name,
                register: async () => {
                    await this.registerFileHandle(name, file, true);
                },
            },
            {
                label: 'file handle without direct IO',
                path: handleFallbackPath,
                register: async () => {
                    await this.registerFileHandle(handleFallbackPath, file, false);
                },
            },
            {
                label: 'buffer',
                path: bufferFallbackPath,
                register: async () => {
                    const fileBuffer = await file.arrayBuffer();
                    await this.registerFileBuffer(bufferFallbackPath, new Uint8Array(fileBuffer));
                },
            },
        ];

        for (const attempt of attempts) {
            try {
                await this.db.dropFile(attempt.path).catch(() => null);
                await attempt.register();
                const scanSql = await probe(attempt.path);
                return { path: attempt.path, scanSql };
            } catch (err: any) {
                await this.db.dropFile(attempt.path).catch(() => null);
                errors.push(`${attempt.label} ${attempt.path}: ${err?.message || String(err)}`);
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

    /**
     * Create a table from rows of JSON.
     *
     * Read with `read_json_auto` rather than duckdb-wasm's `insertJSONFromPath`,
     * which **silently truncates to the first 100 columns**. Not an error, not a
     * warning — a 130-column document simply arrives with 30 columns missing,
     * and which 30 depends on key order. That cost us a whole afternoon: a
     * calculation's output is the original row plus its new values, so a wide
     * dataset pushed the geometry key past the hundredth and the table came back
     * with no geometry column at all, failing later and somewhere else.
     *
     * The reader itself has no such limit; only that API does.
     */
    async registerJsonRows(tableName: string, rows: Record<string, unknown>[]) {
        if (!this.db || !this.conn) throw new Error('DuckDB not initialized');
        const fileName = `${tableName}.json`;
        await this.db.registerFileText(fileName, JSON.stringify(rows));
        await this.conn.query(`DROP TABLE IF EXISTS "${tableName}";`);
        const create = `CREATE OR REPLACE TABLE "${tableName.replace(/"/g, '""')}" AS
            SELECT * FROM read_json_auto('${fileName.replace(/'/g, "''")}');`;
        try {
            await this.conn.query(create);
        } catch (err) {
            // Retry once after dropping again (handles race conditions)
            await this.conn.query(`DROP TABLE IF EXISTS "${tableName}";`);
            await this.conn.query(create);
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
            .map((col: any) => {
                const name = String(col.name || '');
                const loweredName = name.toLowerCase();
                const type = String(col.type || '');
                const mvtType = mvtPropertyTypeForDuckDbType(type);
                if (
                    !name ||
                    ['geojson', 'geometry', 'geom', 'wkb_geometry', 'geometry_bbox'].includes(loweredName) ||
                    loweredName.startsWith('__alur_') ||
                    !mvtType
                ) {
                    return null;
                }

                const identifier = qi(name);
                const baseType = type.trim().toUpperCase().match(/^[A-Z]+/)?.[0] ?? '';
                return {
                    name,
                    selectExpression: baseType === mvtType
                        ? identifier
                        : `CAST(${identifier} AS ${mvtType}) AS ${identifier}`,
                };
            })
            .filter((col): col is { name: string; selectExpression: string } => Boolean(col));
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
                    !lower.startsWith('__alur_') &&
                    !type.includes('geometry') &&
                    !type.includes('blob') &&
                    !type.includes('binary')
                );
            });
    }

    private async layerExtent(tableName: string, geomExpr: string): Promise<LayerExtent | undefined> {
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
            return { minX, minY, maxX, maxY };
        } catch {
            return undefined;
        }
    }

    private estimateCrs(extent: LayerExtent | undefined, hint: string): CrsEstimate {
        const normalizedHint = hint.toLowerCase();
        if (!extent) {
            return {
                code: 'Unknown CRS',
                name: 'Unknown coordinate reference system',
                confidence: 'low',
                reason: 'No geometry extent was available.',
                transformCrs: 'EPSG:4326',
            };
        }

        const withinLonLat =
            extent.minX >= -180 && extent.maxX <= 180 &&
            extent.minY >= -90 && extent.maxY <= 90;
        if (withinLonLat) {
            return {
                code: 'EPSG:4326',
                name: 'WGS 84 longitude/latitude',
                confidence: 'high',
                reason: 'Extent falls within longitude/latitude bounds.',
                transformCrs: 'EPSG:4326',
            };
        }

        const hasBritishGridHint = /\b(osng|osgb|bng|british|national_grid)\b/.test(normalizedHint);
        const withinBritishNationalGrid =
            extent.minX >= -100000 && extent.maxX <= 800000 &&
            extent.minY >= -100000 && extent.maxY <= 1400000;
        if (hasBritishGridHint || withinBritishNationalGrid) {
            return {
                code: 'EPSG:27700',
                name: 'OSGB36 / British National Grid',
                confidence: hasBritishGridHint ? 'high' : 'medium',
                reason: hasBritishGridHint
                    ? 'Filename/table hint and extent match OS National Grid coordinates.'
                    : 'Extent matches the typical British National Grid range.',
                transformCrs: 'EPSG:27700',
            };
        }

        const withinWebMercator =
            Math.abs(extent.minX) <= 20037508.342789244 &&
            Math.abs(extent.maxX) <= 20037508.342789244 &&
            Math.abs(extent.minY) <= 20037508.342789244 &&
            Math.abs(extent.maxY) <= 20037508.342789244;
        if (withinWebMercator) {
            return {
                code: 'EPSG:3857',
                name: 'Web Mercator',
                confidence: 'medium',
                reason: 'Extent fits the Web Mercator coordinate range.',
                transformCrs: 'EPSG:3857',
            };
        }

        return {
            code: 'Unknown projected CRS',
            name: 'Projected coordinate system',
            confidence: 'low',
            reason: 'Extent is outside longitude/latitude bounds but does not match a known heuristic.',
            transformCrs: 'EPSG:4326',
        };
    }

    private async boundsFromExtent(
        extent: LayerExtent | undefined,
        sourceCrs: string,
    ): Promise<[[number, number], [number, number]] | undefined> {
        if (!extent) return undefined;
        if (sourceCrs === 'EPSG:4326') {
            if (extent.minX < -180 || extent.maxX > 180 || extent.minY < -90 || extent.maxY > 90) return undefined;
            return [[extent.minX, extent.minY], [extent.maxX, extent.maxY]];
        }

        try {
            // Projection transforms are monotonic over the supported CRS
            // heuristics, so four extent corners produce map-fit bounds without
            // re-transforming every geometry in the dataset.
            const result = await this.query(`
                WITH corners(x, y) AS (
                    VALUES
                        (${extent.minX}, ${extent.minY}),
                        (${extent.minX}, ${extent.maxY}),
                        (${extent.maxX}, ${extent.minY}),
                        (${extent.maxX}, ${extent.maxY})
                ), transformed AS (
                    SELECT ST_Transform(ST_Point(x, y), '${sourceCrs}', 'EPSG:4326', true) AS geom
                    FROM corners
                )
                SELECT MIN(ST_X(geom)) AS min_x, MIN(ST_Y(geom)) AS min_y,
                       MAX(ST_X(geom)) AS max_x, MAX(ST_Y(geom)) AS max_y
                FROM transformed;
            `);
            const rawRow = result.toArray()[0];
            const row = typeof rawRow?.toJSON === 'function' ? rawRow.toJSON() : rawRow;
            const bounds = [Number(row?.min_x), Number(row?.min_y), Number(row?.max_x), Number(row?.max_y)];
            if (!bounds.every(Number.isFinite)) return undefined;
            if (bounds[0] < -180 || bounds[2] > 180 || bounds[1] < -90 || bounds[3] > 90) return undefined;
            return [[bounds[0], bounds[1]], [bounds[2], bounds[3]]];
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

    /**
     * Read a table as GeoJSON.
     *
     * `sourceCrs` reprojects on the way out. GeoJSON is defined as WGS84
     * (RFC 7946), and a caller handing these features to anything that measures
     * distance — a plugin, an export, another tool — has no way to discover that
     * the numbers are actually projected metres. Consumers were reading Web
     * Mercator coordinates as degrees and getting silently wrong answers.
     */
    async getGeoJSONFromTable(tableName: string, limit = 5000, sourceCrs?: string) {
        const info = await this.query(`PRAGMA table_info('${tableName}');`);
        const columns = info.toArray().map((row: any) => typeof row.toJSON === 'function' ? row.toJSON() : row);

        const crs = sourceCrs?.replace(/'/g, "''");
        const toLonLat = (geometry: string) =>
            crs && crs.toUpperCase() !== 'EPSG:4326'
                ? `ST_Transform(${geometry}, '${crs}', 'EPSG:4326', true)`
                : geometry;

        // 1) Look for a proper geometry column (type = GEOMETRY)
        const geomColStrict = columns.find((col: any) => {
            const type = String(col.type || '').toLowerCase();
            return type === 'geometry';
        });

        if (geomColStrict?.name && this.spatialLoaded) {
            const result = await this.query(
                `SELECT *, ST_AsGeoJSON(${toLonLat(geomColStrict.name)}) AS geojson FROM "${tableName}" LIMIT ${limit};`
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
                        `SELECT *, ST_AsGeoJSON(${toLonLat(`ST_GeomFromWKB(${wkbCol.name})`)}) AS geojson FROM "${tableName}" LIMIT ${limit};`
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

    async prepareMvtTileSource(
        tableName: string,
        options: { filterWhereClause?: string; sourceCrs?: string; columns?: unknown[] } = {},
    ): Promise<MvtTileSource | null> {
        if (!this.spatialLoaded) return null;

        const columns = options.columns ?? await this.getTableSchemaRows(tableName);
        const geomExpr = this.geometryExpression(columns);
        if (!geomExpr) return null;

        const sourceTable = qi(tableName);
        const tileTable = mvtTableNameFor(tableName);
        const propertyProjections = this.propertyColumnsForMvt(columns);
        const propertyColumns = propertyProjections.map(({ name }) => name);
        const propertySelect = propertyProjections.length
            ? `, ${propertyProjections.map(({ selectExpression }) => selectExpression).join(', ')}`
            : '';
        const sourceCrs = options.sourceCrs || 'EPSG:4326';

        await this.query(`
            CREATE OR REPLACE TABLE ${qi(tileTable)} AS
            SELECT
                ROW_NUMBER() OVER ()::BIGINT AS __alur_mvt_id,
                ST_Transform(${geomExpr}, '${sourceCrs}', 'EPSG:3857', true) AS __alur_tile_geom
                ${propertySelect}
            FROM ${sourceTable}
            WHERE ${geomExpr} IS NOT NULL;
        `);

        const typeResult = await this.query(
            `SELECT ST_GeometryType(__alur_tile_geom) AS geometry_type FROM ${qi(tileTable)} WHERE __alur_tile_geom IS NOT NULL LIMIT 1;`
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

        const extent = await this.layerExtent(tableName, geomExpr);
        const crsEstimate = this.estimateCrs(extent, `${tableName} ${options.originalTableName ?? ''}`);
        const bounds = await this.boundsFromExtent(extent, crsEstimate.transformCrs);
        const tileSource = await this.prepareMvtTileSource(tableName, {
            filterWhereClause: options.filterWhereClause,
            sourceCrs: crsEstimate.transformCrs,
            columns,
        });
        if (!tileSource) return null;

        const geomCol = columns.find((col: any) => String(col.type || '').toLowerCase() === 'geometry')
            || columns.find((col: any) => ['geometry', 'geom', 'wkb_geometry'].includes(String(col.name || '').toLowerCase()))
            || { name: 'geometry' };

        return {
            kind: options.kind ?? 'duckdb-table',
            tableName,
            originalTableName: options.originalTableName ?? tableName,
            geometryColumn: String(geomCol.name || 'geometry'),
            crs: crsEstimate.code,
            crsName: crsEstimate.name,
            crsConfidence: crsEstimate.confidence,
            crsReason: crsEstimate.reason,
            geometryKind: tileSource.geometryKind,
            featureIdColumn: '__alur_mvt_id',
            bounds,
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
        const availableProperties = new Set(source.propertyColumns);
        const renderedProperties = source.renderPropertyColumns ?? source.propertyColumns;
        const propertyEntries = renderedProperties
            .filter((name) => availableProperties.has(name))
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
                    "geom": ST_AsMVTGeom(__alur_tile_geom, ST_Extent(tile_bounds), 4096, 64, true),
                    "__alur_mvt_id": __alur_mvt_id,
                    "_alur_feature_id": CAST(__alur_mvt_id AS VARCHAR)
                    ${properties}
                } AS tile_row
                FROM ${qi(source.tableName)}, bounds
                WHERE ST_Intersects(__alur_tile_geom, tile_bounds)
                ${filterClause}
            )
            SELECT ST_AsMVT(tile_row, ${`'${escapeSqlString(source.layerName)}'`}, 4096, 'geom', '__alur_mvt_id') AS tile
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

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  // Debug handle, alongside __alurStore and __alurMap. E2E runs must reach the
  // engine through this rather than by importing this module by path: after an
  // edit Vite serves it under a cache-busting query string, which constructs a
  // second, uninitialised service that fails every query.
  (window as unknown as Record<string, unknown>).__alurDuckdb = duckdbService;
}
