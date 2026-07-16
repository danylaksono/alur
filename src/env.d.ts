/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GEOCODER_URL?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm?url' {
  const src: string;
  export default src;
}

declare module '@duckdb/duckdb-wasm/dist/duckdb-mvp.wasm' {
  const src: string;
  export default src;
}

declare module '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url' {
  const src: string;
  export default src;
}

declare module '@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js' {
  const src: string;
  export default src;
}

declare module '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm?url' {
  const src: string;
  export default src;
}

declare module '@duckdb/duckdb-wasm/dist/duckdb-eh.wasm' {
  const src: string;
  export default src;
}

declare module '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url' {
  const src: string;
  export default src;
}

declare module '@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js' {
  const src: string;
  export default src;
}

declare module '@xyflow/react/dist/style.css';
