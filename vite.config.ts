import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      // geo-morpher's package entry is raw source, and its core does a default
      // import of flubber, which only has named exports — esbuild refuses it.
      // The published ESM bundle has flubber inlined and no external imports at
      // all, so the runtime comes from there while TypeScript still reads the
      // package's own type declarations.
      'geo-morpher': 'geo-morpher/dist/geo-morpher.esm.js'
    }
  },
  optimizeDeps: {
    exclude: ['@duckdb/duckdb-wasm']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('maplibre-gl')) return 'maplibre';
          if (id.includes('@xyflow/react')) return 'workflow';
          if (id.includes('@duckdb/duckdb-wasm')) return 'duckdb';
          // Only fetched when a PMTiles source is actually opened; naming the
          // chunk makes that verifiable rather than a property of whichever way
          // Rollup happened to split the graph.
          if (id.includes('node_modules/pmtiles')) return 'pmtiles';
          if (id.includes('node_modules/gridmapper') || id.includes('node_modules/glpk.js'))
            return 'cartogram';
          if (id.includes('node_modules/lucide-react')) return 'icons';
          return undefined;
        }
      }
    }
  }
})
