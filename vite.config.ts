import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/',
  plugins: [react()],
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
          if (id.includes('node_modules/lucide-react')) return 'icons';
          return undefined;
        }
      }
    }
  }
})
